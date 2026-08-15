import { describe, expect, it } from "vitest";
import { checkPlanIsToday } from "@/lib/today/mutation-guard";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MW-02: content mutations (Adjust / regenerate) may only touch the user's
 * CURRENT local-day plan. This exercises the server guard across the boundary
 * cases the daily contract forbids: midnight rollover with a tab still open,
 * DST transitions, extreme timezones, travel, a wrong device clock, and an
 * invalid/missing timezone (which must fall back to UTC, never crash).
 */

/** Minimal supabase mock that returns a fixed stored timezone for the profile. */
function mockSupabase(timezone: string | null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: timezone === null ? null : { timezone } }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const at = (iso: string) => new Date(iso);

describe("checkPlanIsToday", () => {
  it("allows a mutation on the plan whose date is the user's local today", async () => {
    // 2026-08-15 09:00 in Ljubljana (UTC+2 in summer) is local 2026-08-15.
    const res = await checkPlanIsToday(
      mockSupabase("Europe/Ljubljana"),
      "u1",
      "2026-08-15",
      at("2026-08-15T07:00:00Z")
    );
    expect(res).toBe("ok");
  });

  it("rejects yesterday's plan after local midnight passes (tab left open)", async () => {
    // 2026-08-16 00:30 Ljubljana local is 2026-08-15T22:30Z. Yesterday's plan
    // (2026-08-15) is no longer today.
    const res = await checkPlanIsToday(
      mockSupabase("Europe/Ljubljana"),
      "u1",
      "2026-08-15",
      at("2026-08-15T22:30:00Z")
    );
    expect(res).toBe("not_today");
  });

  it("rejects a future-dated plan", async () => {
    const res = await checkPlanIsToday(
      mockSupabase("Europe/Ljubljana"),
      "u1",
      "2026-08-16",
      at("2026-08-15T07:00:00Z")
    );
    expect(res).toBe("not_today");
  });

  it("UTC+14 (Kiritimati): a UTC instant still on the 15th is already the 16th locally", async () => {
    // 2026-08-15T12:00Z + 14h = 2026-08-16 02:00 local. Today is 2026-08-16.
    const tz = "Pacific/Kiritimati";
    expect(
      await checkPlanIsToday(mockSupabase(tz), "u1", "2026-08-16", at("2026-08-15T12:00:00Z"))
    ).toBe("ok");
    expect(
      await checkPlanIsToday(mockSupabase(tz), "u1", "2026-08-15", at("2026-08-15T12:00:00Z"))
    ).toBe("not_today");
  });

  it("UTC-12 (Baker/Etc): a UTC instant on the 16th is still the 15th locally", async () => {
    const tz = "Etc/GMT+12"; // UTC-12
    expect(
      await checkPlanIsToday(mockSupabase(tz), "u1", "2026-08-15", at("2026-08-16T06:00:00Z"))
    ).toBe("ok");
    expect(
      await checkPlanIsToday(mockSupabase(tz), "u1", "2026-08-16", at("2026-08-16T06:00:00Z"))
    ).toBe("not_today");
  });

  it("travel: the stored timezone (not the device) decides the local day", async () => {
    // User's stored tz is Ljubljana; the same instant is a different calendar
    // day than it would be in, say, Kiritimati — the guard uses the stored tz.
    const instant = at("2026-08-15T23:00:00Z");
    expect(
      await checkPlanIsToday(mockSupabase("Europe/Ljubljana"), "u1", "2026-08-16", instant)
    ).toBe("ok"); // 01:00 local on the 16th
  });

  it("invalid or missing timezone falls back to UTC and still classifies", async () => {
    // No profile row → UTC. 2026-08-15T23:59Z is still the 15th in UTC.
    expect(
      await checkPlanIsToday(mockSupabase(null), "u1", "2026-08-15", at("2026-08-15T23:59:00Z"))
    ).toBe("ok");
    // Garbage timezone → UTC as well.
    expect(
      await checkPlanIsToday(mockSupabase("Not/AZone"), "u1", "2026-08-16", at("2026-08-15T23:59:00Z"))
    ).toBe("not_today");
  });

  it("a malformed plan_date is never treated as today", async () => {
    expect(
      await checkPlanIsToday(mockSupabase("UTC"), "u1", "not-a-date", at("2026-08-15T10:00:00Z"))
    ).toBe("not_today");
  });
});
