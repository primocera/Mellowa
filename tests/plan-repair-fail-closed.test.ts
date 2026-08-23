import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WS-A (v21): the plan-repair route must fail CLOSED when a required database
 * read errors. A read error must never be collapsed into "no plan / no completed
 * items / empty allergy list" — doing so could adjust the day from unobserved
 * state or replace an item the user already finished. On any such error the
 * route returns 503 with nothing changed, calls no provider, releases the usage
 * reservation and finalizes the idempotency attempt as failed.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  plan: { id: "11111111-1111-4111-8111-111111111111", plan_date: "2026-08-23", meal_cards: [{ meal_type: "lunch" }] } as Row | null,
  planError: null as Row | null,
  completions: [] as Row[] | null,
  completionsError: null as Row | null,
  profile: { allergies: ["peanuts"] } as Row | null,
  profileError: null as Row | null,
  providerCalls: 0,
  releaseCalls: [] as unknown[],
  finishCalls: [] as Row[],
}));

function from(table: string) {
  if (table === "daily_plans") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: h.plan, error: h.planError }) }),
        }),
      }),
    };
  }
  if (table === "plan_completions") {
    // .select("item_key").eq("daily_plan_id", id) is awaited directly.
    return { select: () => ({ eq: async () => ({ data: h.completions, error: h.completionsError }) }) };
  }
  if (table === "wellbeing_profiles") {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: h.profile, error: h.profileError }) }),
      }),
    };
  }
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from,
    rpc: async () => ({ data: null, error: null }),
  }),
}));

vi.mock("@/lib/ai/generate-json", () => ({
  generateStructuredJson: async () => {
    h.providerCalls += 1;
    return {};
  },
}));

vi.mock("@/lib/ai/usage", () => ({
  finalizeAiUsage: async () => {},
  releaseReservation: async (id: unknown) => {
    h.releaseCalls.push(id);
  },
  sumUsage: () => ({ status: "success" }),
}));

vi.mock("@/lib/ai/guard", () => ({ guardAiRoute: async () => ({ eventId: "evt-1" }) }));

vi.mock("@/lib/ai/idempotency", () => ({
  isValidIdempotencyKey: () => true,
  claimGenerationRequest: async () => ({ claimed: true, requestId: "req-1" }),
  finishGenerationRequest: async (_c: unknown, opts: Row) => {
    h.finishCalls.push(opts);
  },
}));

vi.mock("@/lib/today/mutation-guard", () => ({ checkPlanIsToday: async () => "ok" }));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: () => true }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));
vi.mock("@/lib/safety/check-input", () => ({
  checkInputSafety: async () => ({ should_block_generation: false }),
}));

import { POST } from "@/app/api/ai/plan-repair/route";

function req() {
  return new Request("http://t/api/ai/plan-repair", {
    method: "POST",
    headers: { "x-idempotency-key": "idem-key-000000000001" },
    body: JSON.stringify({ plan_id: "11111111-1111-4111-8111-111111111111", reason: "less_time" }),
  });
}

beforeEach(() => {
  h.plan = { id: "11111111-1111-4111-8111-111111111111", plan_date: "2026-08-23", meal_cards: [{ meal_type: "lunch" }] };
  h.planError = null;
  h.completions = [];
  h.completionsError = null;
  h.profile = { allergies: ["peanuts"] };
  h.profileError = null;
  h.providerCalls = 0;
  h.releaseCalls = [];
  h.finishCalls = [];
});

async function expectFailClosed(status: number, error: string) {
  const res = await POST(req());
  expect(res.status).toBe(status);
  expect((await res.json()).error).toBe(error);
  expect(h.providerCalls).toBe(0);
  expect(h.releaseCalls).toContain("evt-1");
}

describe("plan-repair fails closed on required-read errors (WS-A)", () => {
  it("daily_plans query error → 503 data_unavailable, no provider, idempotency failed", async () => {
    h.planError = { message: "db down" };
    await expectFailClosed(503, "data_unavailable");
    expect(h.finishCalls.some((c) => c.status === "failed")).toBe(true);
  });

  it("a successful no-row plan is still a genuine 404", async () => {
    h.plan = null;
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(h.providerCalls).toBe(0);
  });

  it("plan_completions query error → 503, completed scope never recomputed from []", async () => {
    h.completionsError = { message: "db down" };
    await expectFailClosed(503, "data_unavailable");
  });

  it("wellbeing_profiles query error → 503, no empty-allergy fallback, no provider", async () => {
    h.profileError = { message: "db down" };
    await expectFailClosed(503, "data_unavailable");
  });

  it("verified-absent profile → 400 onboarding_required, no provider", async () => {
    h.profile = null;
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("onboarding_required");
    expect(h.providerCalls).toBe(0);
    expect(h.releaseCalls).toContain("evt-1");
  });
});
