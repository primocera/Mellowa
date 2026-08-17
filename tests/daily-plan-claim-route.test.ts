import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-02 (v20): the daily-plan route acquires an ATOMIC pre-provider claim keyed
 * by (user, canonical local date) — independent of the idempotency key — BEFORE
 * any provider spend. These tests exercise the real POST handler with a stateful
 * claim RPC and a GATED provider, so they assert the property that matters:
 * the provider is called at most once per user per local day, even when two
 * requests with different idempotency keys overlap.
 *
 * The provider (generateDailyPlanV2) is a spy; the (user, day) claim and idem
 * claim run through a scripted supabase.rpc that mirrors migration 051's lease
 * semantics.
 */

type Row = Record<string, unknown>;

let uuidN = 0;
const uuid = () => `owner-${++uuidN}`;

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "u1@example.com" } as { id: string; email?: string } | null,
  profile: { timezone: "UTC", allergies: [] as string[] } as Row | null,
  existingPlan: null as Row | null, // canonical pre-read result
  savePlanError: null as Row | null,
  providerCalls: [] as number[],
  providerGate: null as null | Promise<void>,
  finalizeCalls: [] as Row[],
  releaseCalls: [] as unknown[],
  emailCalls: [] as Row[],
  dayClaims: new Map<string, Row>(),
}));

function samplePlan(): Row {
  return {
    plan_summary: "A gentle day.",
    plan_intensity: "light",
    plan_mode: "balanced",
    meal_cards: [], // empty → skip meal-card persistence branch
    hydration_plan: { reminders: [] },
    movement_moment: "A short walk.",
    breathing_exercise: null,
    meditation_or_reflection: null,
    relaxation_technique: null,
    focus_block: null,
    evening_wind_down: null,
    one_small_habit: "Drink water.",
    encouragement: "You've got this.",
    safety_note: "Rest if you need to.",
  };
}

function daily_plans_builder() {
  const filters: Row = {};
  const api: Row = {
    select: () => api,
    eq: (c: string, v: unknown) => {
      filters[c] = v;
      return api;
    },
    is: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: async () => {
      if ("id" in filters) {
        // lookup-by-id (duplicate / idem success path): return the claim result
        return { data: h.existingPlan, error: null };
      }
      return { data: h.existingPlan, error: null }; // canonical pre-read
    },
    insert: () => ({
      select: () => ({
        single: async () =>
          h.savePlanError
            ? { data: null, error: h.savePlanError }
            : { data: { id: "plan-1", plan_mode: "balanced" }, error: null },
      }),
    }),
  };
  return api;
}

function generic_select() {
  const api: Row = {
    select: () => api,
    eq: () => api,
    order: () => api,
    limit: () => api,
    is: () => api,
    then: (resolve: (v: Row) => void) => resolve({ data: [], error: null }),
    insert: async () => ({ error: null }),
  };
  return api;
}

function from(table: string) {
  if (table === "daily_plans") return daily_plans_builder();
  if (table === "wellbeing_profiles") {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: h.profile, error: null }) }),
      }),
    };
  }
  if (table === "daily_checkins") {
    return {
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: "checkin-1" }, error: null }) }),
      }),
    };
  }
  return generic_select();
}

async function rpc(name: string, args: Row) {
  if (name === "claim_daily_plan_generation") {
    const key = `${args.p_user_id}:${args.p_local_date}`;
    const now = Date.now();
    const row = h.dayClaims.get(key);
    if (row) {
      if (row.status === "succeeded")
        return { data: { outcome: "duplicate", status: "succeeded", result_id: row.result_id }, error: null };
      if (row.status === "claimed" && (row.lease as number) > now)
        return { data: { outcome: "in_progress", retry_after_seconds: 5 }, error: null };
      const owner = uuid();
      Object.assign(row, { status: "claimed", owner, attempt: (row.attempt as number) + 1, lease: now + 120000, result_id: null });
      return { data: { outcome: "claimed", owner_request_id: owner, attempt: row.attempt, reclaimed: true }, error: null };
    }
    const owner = uuid();
    h.dayClaims.set(key, { status: "claimed", owner, attempt: 1, lease: now + 120000, result_id: null });
    return { data: { outcome: "claimed", owner_request_id: owner, attempt: 1, reclaimed: false }, error: null };
  }
  if (name === "finish_daily_plan_generation") {
    const key = `${args.p_user_id}:${args.p_local_date}`;
    const row = h.dayClaims.get(key);
    if (row && row.owner === args.p_owner_request_id) {
      row.status = args.p_status;
      if (args.p_status === "succeeded") row.result_id = args.p_result_id;
    }
    return { data: null, error: null };
  }
  if (name === "claim_generation_request")
    return { data: { claimed: true, request_id: `req-${uuid()}` }, error: null };
  if (name === "finish_generation_request") return { data: null, error: null };
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from,
    rpc,
  }),
}));

vi.mock("@/lib/ai/generate-daily-plan-v2", () => ({
  generateDailyPlanV2: async (args: { usageSink: { usage?: Row } }) => {
    h.providerCalls.push(Date.now());
    if (h.providerGate) await h.providerGate;
    args.usageSink.usage = {
      provider: "anthropic",
      model: "test-model",
      inputTokens: 100,
      outputTokens: 200,
      latencyMs: 10,
      status: "success",
    };
    return samplePlan();
  },
}));

vi.mock("@/lib/ai/quality-checks", () => ({
  checkDailyPlanV2Quality: () => ({ ok: true, reasons: [] }),
}));

vi.mock("@/lib/ai/usage", () => ({
  finalizeAiUsage: async (_id: unknown, opts: Row) => {
    h.finalizeCalls.push(opts);
  },
  releaseReservation: async (id: unknown) => {
    h.releaseCalls.push(id);
  },
}));

vi.mock("@/lib/ai/guard", () => ({
  guardAiRoute: async () => ({ eventId: "evt-1" }),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  canGenerateDailyPlan: async () => true,
  getUserPlan: async () => "premium",
}));

vi.mock("@/lib/safety/check-input", () => ({
  checkInputSafety: async () => ({ should_block_generation: false, user_message: null }),
}));

vi.mock("@/lib/email/deliver", () => ({
  deliverEmail: async (payload: Row) => {
    h.emailCalls.push(payload);
  },
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

import { POST } from "@/app/api/ai/daily-plan/route";

function req(idemKey?: string) {
  return new Request("http://t/api/ai/daily-plan", {
    method: "POST",
    headers: idemKey ? { "x-idempotency-key": idemKey } : {},
    body: JSON.stringify({ energy_level: 3, stress_level: 3 }),
  });
}

beforeEach(() => {
  h.user = { id: "u1", email: "u1@example.com" };
  h.profile = { timezone: "UTC", allergies: [] };
  h.existingPlan = null;
  h.savePlanError = null;
  h.providerCalls = [];
  h.providerGate = null;
  h.finalizeCalls = [];
  h.releaseCalls = [];
  h.emailCalls = [];
  h.dayClaims = new Map();
});

describe("MW-02 daily-plan atomic claim", () => {
  it("winner: one provider call, plan saved, 200", async () => {
    const res = await POST(req("aaaaaaaa-1"));
    expect(res.status).toBe(200);
    expect(h.providerCalls).toHaveLength(1);
    const json = (await res.json()) as Row;
    expect((json.plan as Row).id).toBe("plan-1");
  });

  it("two overlapping requests with DIFFERENT idem keys → provider called exactly once", async () => {
    // Winner enters the provider and blocks there.
    let release!: () => void;
    h.providerGate = new Promise<void>((r) => (release = r));
    const winner = POST(req("key-winner-1"));
    // Let the winner reach (and block inside) the provider.
    await new Promise((r) => setTimeout(r, 20));
    // Follower arrives with a different idem key while the winner still holds
    // the (user, day) lease.
    const followerRes = await POST(req("key-follower-2"));
    expect(followerRes.status).toBe(409);
    expect((await followerRes.json()).status).toBe("in_progress");
    // Only the winner ever called the provider.
    expect(h.providerCalls).toHaveLength(1);
    // Release the winner and confirm it still succeeds with one provider call.
    release();
    const winnerRes = await winner;
    expect(winnerRes.status).toBe(200);
    expect(h.providerCalls).toHaveLength(1);
  });

  it("claim unavailable → 503 fail closed, provider never called", async () => {
    const orig = h.dayClaims;
    // Force the claim RPC to error by swapping the map for a poisoned getter is
    // overkill; instead simulate by making rpc throw for the claim once.
    const spy = vi.spyOn(await import("@/lib/ai/daily-plan-claim"), "claimDailyPlanGeneration");
    spy.mockResolvedValueOnce({ outcome: "unavailable" });
    const res = await POST(req("bbbbbbbb-1"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("generation_unavailable");
    expect(h.providerCalls).toHaveLength(0);
    spy.mockRestore();
    h.dayClaims = orig;
  });

  it("duplicate: claim already succeeded returns the canonical plan, no provider call", async () => {
    h.dayClaims.set("u1:" + new Date().toISOString().slice(0, 10), {
      status: "succeeded",
      owner: "o",
      attempt: 1,
      lease: 0,
      result_id: "plan-existing",
    });
    h.existingPlan = { id: "plan-existing", plan_mode: "balanced" };
    const res = await POST(req("cccccccc-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).deduplicated).toBe(true);
    expect(h.providerCalls).toHaveLength(0);
  });
});

describe("MW-02 migration 051 defines the atomic day-scoped claim", () => {
  it("claims by (user, local_date) with a fencing token and lease, before provider", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(
      "supabase/migrations/051_mellowa_v20_daily_plan_claim.sql",
      "utf8"
    );
    expect(sql).toMatch(/primary key \(user_id, local_date\)/);
    expect(sql).toMatch(/owner_request_id/); // fencing token
    expect(sql).toMatch(/lease_expires_at/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    // finish is gated on the current lease holder
    expect(sql).toMatch(/owner_request_id = p_owner_request_id/);
  });
});
