import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-01 (v20): plan-completion cross-user integrity + stale-day guard.
 *
 * The completion endpoint must prove the parent daily_plans row belongs to the
 * caller and is the current-local-day canonical plan BEFORE it mutates
 * plan_completions, must never leak whether a foreign UUID exists, must fail
 * closed (503) when timezone/plan reads are unavailable, and must emit the
 * now_action_done value event only after a durable write.
 *
 * These are route-level tests over the real POST handler with a scripted
 * Supabase double; the database-layer parent-ownership invariant is enforced
 * separately by migration 050 (asserted in tests/migration-sql.test.ts style
 * source checks below).
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: { id: "owner" } as { id: string } | null,
  // wellbeing_profiles read (resolveCurrentDay)
  tz: { data: { timezone: "UTC" } as Row | null, error: null as Row | null },
  // daily_plans ownership read
  plan: { data: null as Row | null, error: null as Row | null },
  upsertError: null as Row | null,
  deleteError: null as Row | null,
  upserts: [] as Row[],
  deletes: [] as Row[],
  tracked: [] as Array<{ event: string; opts: unknown }>,
}));

function builder(table: string) {
  const state: { op?: "delete"; filters: Row } = { filters: {} };
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (col: string, val: unknown) => {
      state.filters[col] = val;
      return api;
    },
    is: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: async () => {
      if (table === "wellbeing_profiles") return h.tz;
      if (table === "daily_plans") return h.plan;
      return { data: null, error: null };
    },
    upsert: async (row: Row) => {
      if (table === "plan_completions" && !h.upsertError) h.upserts.push(row);
      return { error: h.upsertError };
    },
    delete: () => {
      state.op = "delete";
      // delete resolves after its .eq chain is awaited
      return {
        eq: (col: string, val: unknown) => {
          state.filters[col] = val;
          return {
            eq: (c2: string, v2: unknown) => {
              state.filters[c2] = v2;
              return {
                eq: async (c3: string, v3: unknown) => {
                  state.filters[c3] = v3;
                  if (table === "plan_completions" && !h.deleteError)
                    h.deletes.push({ ...state.filters });
                  return { error: h.deleteError };
                },
              };
            },
          };
        },
      };
    },
  };
  return api;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => builder(table),
  }),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: (event: string, opts: unknown) => h.tracked.push({ event, opts }),
}));

import { POST } from "@/app/api/plan/complete/route";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";

function req(body: Row) {
  return new Request("http://t/api/plan/complete", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.user = { id: "owner" };
  h.tz = { data: { timezone: "UTC" }, error: null };
  // by default the plan is the owner's current-day canonical plan
  h.plan = {
    data: {
      id: PLAN_ID,
      plan_mode: "balanced",
      plan_date: new Date().toISOString().slice(0, 10),
      superseded_at: null,
    },
    error: null,
  };
  h.upsertError = null;
  h.deleteError = null;
  h.upserts = [];
  h.deletes = [];
  h.tracked = [];
});

describe("POST /api/plan/complete — auth + ownership", () => {
  it("401 unauthenticated, no mutation", async () => {
    h.user = null;
    const res = await POST(req({ plan_id: PLAN_ID, item_key: "movement", done: true }));
    expect(res.status).toBe(401);
    expect(h.upserts).toEqual([]);
    expect(h.tracked).toEqual([]);
  });

  it("owner current-day plan: complete succeeds and persists", async () => {
    const res = await POST(req({ plan_id: PLAN_ID, item_key: "movement", done: true }));
    expect(res.status).toBe(200);
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0]).toMatchObject({ user_id: "owner", daily_plan_id: PLAN_ID });
  });

  it("repeat complete (idempotent upsert) still succeeds", async () => {
    await POST(req({ plan_id: PLAN_ID, item_key: "movement", done: true }));
    const res = await POST(req({ plan_id: PLAN_ID, item_key: "movement", done: true }));
    expect(res.status).toBe(200);
    expect(h.upserts).toHaveLength(2);
  });

  it("uncomplete deletes the owner's row", async () => {
    const res = await POST(req({ plan_id: PLAN_ID, item_key: "movement", done: false }));
    expect(res.status).toBe(200);
    expect(h.deletes).toHaveLength(1);
    expect(h.deletes[0]).toMatchObject({ user_id: "owner", daily_plan_id: PLAN_ID });
  });

  it("foreign / missing plan UUID: generic 404, zero rows, zero analytics", async () => {
    h.plan = { data: null, error: null }; // not owned by caller
    const res = await POST(
      req({ plan_id: PLAN_ID, item_key: "movement", done: true, source: "now" })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
    expect(h.upserts).toEqual([]);
    expect(h.tracked).toEqual([]);
  });
});

describe("POST /api/plan/complete — stale day", () => {
  it("superseded plan → 409 stale_day, no mutation", async () => {
    (h.plan.data as Row).superseded_at = new Date().toISOString();
    const res = await POST(req({ plan_id: PLAN_ID, item_key: "movement", done: true }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_day");
    expect(h.upserts).toEqual([]);
  });

  it("yesterday's plan (tab open across midnight) → 409 stale_day", async () => {
    (h.plan.data as Row).plan_date = "2000-01-01";
    const res = await POST(req({ plan_id: PLAN_ID, item_key: "movement", done: true }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_day");
    expect(h.upserts).toEqual([]);
  });

  it("tomorrow's plan → 409 stale_day", async () => {
    (h.plan.data as Row).plan_date = "2999-12-31";
    const res = await POST(req({ plan_id: PLAN_ID, item_key: "movement", done: true }));
    expect(res.status).toBe(409);
    expect(h.upserts).toEqual([]);
  });
});

describe("POST /api/plan/complete — fail closed", () => {
  it("timezone read unavailable → 503, no mutation, no analytics", async () => {
    h.tz = { data: null, error: { code: "PGRST500" } };
    const res = await POST(
      req({ plan_id: PLAN_ID, item_key: "movement", done: true, source: "now" })
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("data_unavailable");
    expect(h.upserts).toEqual([]);
    expect(h.tracked).toEqual([]);
  });

  it("plan ownership read error → 503, no mutation", async () => {
    h.plan = { data: null, error: { code: "PGRST500" } };
    const res = await POST(req({ plan_id: PLAN_ID, item_key: "movement", done: true }));
    expect(res.status).toBe(503);
    expect(h.upserts).toEqual([]);
  });

  it("missing/invalid profile timezone falls back safely (still completes)", async () => {
    h.tz = { data: { timezone: null }, error: null };
    const res = await POST(req({ plan_id: PLAN_ID, item_key: "movement", done: true }));
    expect(res.status).toBe(200);
    expect(h.upserts).toHaveLength(1);
  });
});

describe("POST /api/plan/complete — analytics only after durable write", () => {
  it("emits now_action_done after a durable Now completion", async () => {
    const res = await POST(
      req({ plan_id: PLAN_ID, item_key: "movement", done: true, source: "now" })
    );
    expect(res.status).toBe(200);
    expect(h.tracked).toHaveLength(1);
    expect(h.tracked[0].event).toBe("now_action_done");
  });

  it("does NOT emit the value event when the durable write fails", async () => {
    h.upsertError = { code: "23505" };
    const res = await POST(
      req({ plan_id: PLAN_ID, item_key: "movement", done: true, source: "now" })
    );
    expect(res.status).toBe(500);
    expect(h.tracked).toEqual([]);
  });
});

describe("MW-01 migration 050 enforces parent ownership at the DB layer", () => {
  it("INSERT/UPDATE policies check the parent plan owner and repair invalid rows", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(
      "supabase/migrations/050_mellowa_v20_completion_parent_ownership.sql",
      "utf8"
    );
    // parent-ownership EXISTS on both INSERT and UPDATE
    expect(sql).toMatch(/for insert with check[\s\S]*dp\.user_id = auth\.uid\(\)/);
    expect(sql).toMatch(/for update[\s\S]*dp\.user_id = auth\.uid\(\)/);
    // deterministic repair of provably-invalid rows
    expect(sql).toMatch(/delete from public\.plan_completions[\s\S]*pc\.user_id <> dp\.user_id/);
  });
});
