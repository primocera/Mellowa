import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECKIN_LIMITS,
  CONSENT_VERSION,
  DailyCheckinInput,
  PROFILE_LIMITS,
  WellbeingProfileInput,
} from "@/schemas/wellbeing";

/**
 * The onboarding wellbeing baseline (health-adjacent data) is saved server-side:
 * authenticated, consent-checked (same check as guardAiRoute), Zod-validated
 * with bounded fields, and the server — not the browser — stamps the consent
 * version. Nothing is stored without consent.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  consent: { complete: true, missing: [] as string[] },
  upserts: [] as Array<{ table: string; row: Row; opts: unknown }>,
  upsertError: null as Row | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => ({
      upsert: async (row: Row, opts: unknown) => {
        h.upserts.push({ table, row, opts });
        return { error: h.upsertError };
      },
    }),
  }),
}));

vi.mock("@/lib/consent/status", () => ({
  getConsentStatus: async () => h.consent,
}));

import { POST } from "@/app/api/onboarding/profile/route";

const VALID = {
  wake_time: "07:00",
  sleep_time: "23:00",
  work_schedule: "Office hours",
  primary_goal: "better_meal_rhythm",
  food_preferences: ["vegetarian"],
  allergies: ["peanuts"],
  disliked_ingredients: ["olives"],
  cooking_time: "15_30",
  budget_level: "medium",
  energy_baseline: 3,
  stress_baseline: 3,
  sleep_quality_baseline: 3,
  movement_level: "lightly_active",
  preferred_tone: "gentle",
  safety_acknowledged: true,
  is_adult: true,
  timezone: "Europe/Ljubljana",
  locale: "sl-SI",
  allergies_severe: false,
};

const req = (body: unknown) =>
  new Request("http://t/api/onboarding/profile", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  h.user = { id: "u1" };
  h.consent = { complete: true, missing: [] };
  h.upserts = [];
  h.upsertError = null;
});

describe("POST /api/onboarding/profile", () => {
  it("401 when signed out; nothing stored", async () => {
    h.user = null;
    const res = await POST(req(VALID));
    expect(res.status).toBe(401);
    expect(h.upserts).toEqual([]);
  });

  it("403 consent_required when a required consent is missing; nothing stored", async () => {
    h.consent = { complete: false, missing: ["privacy"] };
    const res = await POST(req(VALID));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "consent_required", missing: ["privacy"] });
    expect(h.upserts).toEqual([]);
  });

  it("400 on invalid JSON and on schema violations (e.g. an over-long list item)", async () => {
    expect((await POST(req("{not json"))).status).toBe(400);
    const res = await POST(req({ ...VALID, allergies: ["x".repeat(PROFILE_LIMITS.listItemChars + 1)] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_input");
    expect(body.user_message).toMatch(/under 60 characters/);
    expect(h.upserts).toEqual([]);
  });

  it("saves with the server-stamped consent version, ignoring any client-sent consent fields", async () => {
    const res = await POST(
      req({ ...VALID, allergies_severe: true, consent_version: "1999-01-01", consent_accepted_at: "1999-01-01T00:00:00Z" })
    );
    expect(res.status).toBe(200);
    expect(h.upserts).toHaveLength(1);
    const { table, row, opts } = h.upserts[0];
    expect(table).toBe("wellbeing_profiles");
    expect(opts).toEqual({ onConflict: "user_id" });
    expect(row.user_id).toBe("u1");
    expect(row.consent_version).toBe(CONSENT_VERSION);
    expect(row.consent_accepted_at).not.toBe("1999-01-01T00:00:00Z");
    expect(row.allergies_severe).toBe(true);
    expect(row.stress_baseline).toBe("3");
  });

  it("a DB write failure is a retryable 503 with no raw provider error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.upsertError = { code: "23514", message: "violates check constraint secret_detail" };
    const res = await POST(req(VALID));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("secret_detail");
  });
});

describe("wellbeing schema bounds", () => {
  const base = { ...VALID } as Row;
  const ok = (patch: Row) => WellbeingProfileInput.safeParse({ ...base, ...patch }).success;

  it("bounds free-text profile fields", () => {
    expect(ok({ work_schedule: "x".repeat(PROFILE_LIMITS.workScheduleChars) })).toBe(true);
    expect(ok({ work_schedule: "x".repeat(PROFILE_LIMITS.workScheduleChars + 1) })).toBe(false);
    expect(ok({ wake_time: "x".repeat(PROFILE_LIMITS.timeChars + 1) })).toBe(false);
    expect(ok({ sleep_time: "x".repeat(PROFILE_LIMITS.timeChars + 1) })).toBe(false);
    expect(ok({ timezone: "x".repeat(PROFILE_LIMITS.timezoneChars + 1) })).toBe(false);
    expect(ok({ locale: "x".repeat(PROFILE_LIMITS.localeChars + 1) })).toBe(false);
  });

  it("bounds list item length and item count for every list field", () => {
    for (const field of ["food_preferences", "allergies", "disliked_ingredients"]) {
      expect(ok({ [field]: Array(PROFILE_LIMITS.listMaxItems).fill("a") }), field).toBe(true);
      expect(ok({ [field]: Array(PROFILE_LIMITS.listMaxItems + 1).fill("a") }), field).toBe(false);
      expect(ok({ [field]: ["x".repeat(PROFILE_LIMITS.listItemChars)] }), field).toBe(true);
      expect(ok({ [field]: ["x".repeat(PROFILE_LIMITS.listItemChars + 1)] }), field).toBe(false);
    }
  });

  it("the documented limits are the ones migration 055 mirrors", () => {
    expect(PROFILE_LIMITS).toEqual({
      timeChars: 16,
      workScheduleChars: 200,
      listItemChars: 60,
      listMaxItems: 30,
      timezoneChars: 64,
      localeChars: 16,
    });
    expect(CHECKIN_LIMITS).toEqual({
      hungerPatternChars: 300,
      timeAvailableChars: 60,
      todayFocusChars: 300,
      notesChars: 2000,
    });
  });

  it("bounds the check-in free-text fields, and every time preset fits", () => {
    const c = (patch: Row) =>
      DailyCheckinInput.safeParse({ energy_level: 3, stress_level: 3, ...patch }).success;
    expect(c({ hunger_pattern: "x".repeat(CHECKIN_LIMITS.hungerPatternChars) })).toBe(true);
    expect(c({ hunger_pattern: "x".repeat(CHECKIN_LIMITS.hungerPatternChars + 1) })).toBe(false);
    expect(c({ today_focus: "x".repeat(CHECKIN_LIMITS.todayFocusChars + 1) })).toBe(false);
    expect(c({ time_available: "x".repeat(CHECKIN_LIMITS.timeAvailableChars + 1) })).toBe(false);
    expect(c({ notes: "x".repeat(CHECKIN_LIMITS.notesChars + 1) })).toBe(false);
    const form = readFileSync("src/components/dailyflow/checkin-form.tsx", "utf8");
    const presets = /const TIME_OPTIONS = \[([\s\S]*?)\]/.exec(form)?.[1] ?? "";
    const values = [...presets.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(c({ time_available: v }), v).toBe(true);
  });
});

describe("the wizard no longer writes the profile from the browser", () => {
  const wizard = readFileSync("src/components/dailyflow/onboarding-wizard.tsx", "utf8");

  it("posts to the server route and never sets consent fields itself", () => {
    expect(wizard).toContain('fetch("/api/onboarding/profile"');
    expect(wizard).not.toMatch(/from\("wellbeing_profiles"\)/);
    expect(wizard).not.toContain("consent_version");
    expect(wizard).not.toContain("consent_accepted_at");
    expect(wizard).not.toContain("@/lib/supabase/client");
  });
});
