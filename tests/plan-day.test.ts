import { describe, expect, it } from "vitest";
import {
  planDateFor,
  classifyPlanDay,
  isRolloverNeeded,
  mutationIdempotencyKey,
  checkMutationAllowed,
} from "@/lib/today/plan-day";

/**
 * MW-V18-14: the plan's identity is the user's local date (server-computed),
 * midnight rollover is deterministic and preserves history, mutations are
 * idempotent, and a stale version or a non-today target is rejected rather than
 * mutating the wrong day.
 */

describe("canonical plan date is timezone-driven", () => {
  it("uses the user's timezone, not UTC", () => {
    // 2026-08-17T00:30Z is still 2026-08-16 in New York (UTC-4).
    expect(planDateFor(new Date("2026-08-17T00:30:00Z"), "America/New_York")).toBe("2026-08-16");
    expect(planDateFor(new Date("2026-08-17T00:30:00Z"), "UTC")).toBe("2026-08-17");
  });
});

describe("classify a stored plan relative to local today", () => {
  const now = new Date("2026-08-14T12:00:00Z");
  it("today / past / future", () => {
    expect(classifyPlanDay("2026-08-14", now, "UTC")).toBe("today");
    expect(classifyPlanDay("2026-08-13", now, "UTC")).toBe("past");
    expect(classifyPlanDay("2026-08-15", now, "UTC")).toBe("future");
  });
});

describe("midnight rollover is deterministic and history-preserving", () => {
  const now = new Date("2026-08-14T00:10:00Z"); // just after local midnight UTC

  it("a past-day plan triggers loading today (never mutating the old day)", () => {
    expect(isRolloverNeeded("2026-08-13", now, "UTC")).toBe(true);
  });
  it("today's plan does not roll over", () => {
    expect(isRolloverNeeded("2026-08-14", now, "UTC")).toBe(false);
  });
  it("nothing loaded → load today", () => {
    expect(isRolloverNeeded(null, now, "UTC")).toBe(true);
  });
  it("a FUTURE-dated plan (wrong clock / stale tab) never triggers a rollover mutation", () => {
    expect(isRolloverNeeded("2026-08-20", now, "UTC")).toBe(false);
  });
});

describe("idempotency keys collapse duplicates", () => {
  it("same action on the same item/day/user derives the same key", () => {
    const a = mutationIdempotencyKey("u1", "2026-08-14", "complete", "meal:lunch");
    const b = mutationIdempotencyKey("u1", "2026-08-14", "complete", "meal:lunch");
    expect(a).toBe(b);
    // Different action or item → different key.
    expect(a).not.toBe(mutationIdempotencyKey("u1", "2026-08-14", "undo", "meal:lunch"));
    expect(a).not.toBe(mutationIdempotencyKey("u1", "2026-08-14", "complete", "meal:dinner"));
  });
});

describe("mutation conflict guard", () => {
  const now = new Date("2026-08-14T12:00:00Z");
  const base = { planDate: "2026-08-14", now, timeZone: "UTC" };

  it("allows an up-to-date mutation on today's plan", () => {
    expect(checkMutationAllowed({ ...base, clientVersion: 3, serverVersion: 3 })).toBe("ok");
  });
  it("rejects a stale client version (another tab advanced it)", () => {
    expect(checkMutationAllowed({ ...base, clientVersion: 2, serverVersion: 3 })).toBe("stale");
  });
  it("rejects a mutation targeting a non-today plan (midnight passed / wrong clock)", () => {
    expect(
      checkMutationAllowed({ ...base, planDate: "2026-08-13", clientVersion: 3, serverVersion: 3 })
    ).toBe("not_today");
  });
  it("stale takes precedence over not_today", () => {
    expect(
      checkMutationAllowed({ ...base, planDate: "2026-08-13", clientVersion: 1, serverVersion: 3 })
    ).toBe("stale");
  });
});
