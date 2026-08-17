import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-03 (v20): timezone and weekly-facts database errors must fail CLOSED.
 *
 * A genuinely missing/invalid stored timezone still uses the documented UTC
 * fallback, but a database READ FAILURE must never be laundered into that
 * fallback — the daily/weekly surfaces return 503 data_unavailable instead of
 * mutating a UTC-fallback day or presenting a real week as blank.
 */

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// resolveTimeZoneState / checkPlanIsToday unit contracts
// ---------------------------------------------------------------------------
function profileClient(result: { data: Row | null; error: Row | null }) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => result }) }),
    }),
  } as never;
}

describe("resolveTimeZoneState (MW-03)", () => {
  it("resolved for a valid stored zone", async () => {
    const { resolveTimeZoneState } = await import("@/lib/dates/current-day");
    const r = await resolveTimeZoneState(
      profileClient({ data: { timezone: "Europe/Ljubljana" }, error: null }),
      "u1"
    );
    expect(r).toEqual({ status: "resolved", timeZone: "Europe/Ljubljana" });
  });

  it("missing_or_invalid for an absent or bogus zone (safe fallback)", async () => {
    const { resolveTimeZoneState } = await import("@/lib/dates/current-day");
    expect((await resolveTimeZoneState(profileClient({ data: null, error: null }), "u1")).status).toBe(
      "missing_or_invalid"
    );
    expect(
      (await resolveTimeZoneState(profileClient({ data: { timezone: "Mars/Phobos" }, error: null }), "u1"))
        .status
    ).toBe("missing_or_invalid");
  });

  it("unavailable when the read errors (fail closed)", async () => {
    const { resolveTimeZoneState } = await import("@/lib/dates/current-day");
    const r = await resolveTimeZoneState(
      profileClient({ data: null, error: { code: "PGRST500" } }),
      "u1"
    );
    expect(r.status).toBe("unavailable");
  });
});

describe("checkPlanIsToday (MW-03 third state)", () => {
  it("returns 'unavailable' on a timezone read error instead of UTC-classifying", async () => {
    const { checkPlanIsToday } = await import("@/lib/today/mutation-guard");
    const res = await checkPlanIsToday(
      profileClient({ data: null, error: { code: "PGRST500" } }),
      "u1",
      "2026-08-15",
      new Date("2026-08-15T07:00:00Z")
    );
    expect(res).toBe("unavailable");
  });

  it("still falls back to UTC (not unavailable) for a missing timezone", async () => {
    const { checkPlanIsToday } = await import("@/lib/today/mutation-guard");
    const res = await checkPlanIsToday(
      profileClient({ data: { timezone: null }, error: null }),
      "u1",
      new Date().toISOString().slice(0, 10),
      new Date()
    );
    expect(res).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// Weekly reflection GET route: outage vs empty week
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  tz: { data: { timezone: "UTC" } as Row | null, error: null as Row | null },
  plans: { data: [] as Row[], error: null as Row | null },
  feedback: { data: [] as Row[], error: null as Row | null },
  fav: { data: [] as Row[], error: null as Row | null },
  reflection: { data: null as Row | null, error: null as Row | null },
}));

function listBuilder(result: () => Row) {
  const api: Row = {
    select: () => api,
    eq: () => api,
    gte: () => api,
    lt: () => api,
    then: (resolve: (v: Row) => void) => resolve(result()),
    maybeSingle: async () => result(),
  };
  return api;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => {
      if (table === "wellbeing_profiles")
        return { select: () => ({ eq: () => ({ maybeSingle: async () => h.tz }) }) };
      if (table === "daily_plans") return listBuilder(() => h.plans);
      if (table === "plan_feedback") return listBuilder(() => h.feedback);
      if (table === "favourite_meals") return listBuilder(() => h.fav);
      if (table === "weekly_reflections") return listBuilder(() => h.reflection);
      return listBuilder(() => ({ data: [], error: null }));
    },
  }),
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

import { GET } from "@/app/api/week/reflection/route";

beforeEach(() => {
  h.user = { id: "u1" };
  h.tz = { data: { timezone: "UTC" }, error: null };
  h.plans = { data: [], error: null };
  h.feedback = { data: [], error: null };
  h.fav = { data: [], error: null };
  h.reflection = { data: null, error: null };
});

describe("GET /api/week/reflection — fail closed (MW-03)", () => {
  it("200 on a healthy read (empty week is a real, non-error state)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as Row;
    expect(json).toHaveProperty("facts");
    expect(json.state).toBe("available");
  });

  it("503 when the timezone read errors (never computes the week in UTC)", async () => {
    h.tz = { data: null, error: { code: "PGRST500" } };
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("data_unavailable");
  });

  it("503 when the plans query fails (not an empty week)", async () => {
    h.plans = { data: [], error: { code: "PGRST500" } };
    const res = await GET();
    expect(res.status).toBe(503);
  });

  it("503 when the feedback query fails", async () => {
    h.feedback = { data: [], error: { code: "PGRST500" } };
    expect((await GET()).status).toBe(503);
  });

  it("503 when the favourites query fails", async () => {
    h.fav = { data: [], error: { code: "PGRST500" } };
    expect((await GET()).status).toBe(503);
  });

  it("503 when the saved-reflection query fails", async () => {
    h.reflection = { data: null, error: { code: "PGRST500" } };
    expect((await GET()).status).toBe(503);
  });
});
