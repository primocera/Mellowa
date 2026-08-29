import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WS-A (v21): regenerate-section must fail CLOSED when a required read errors.
 * Allergies/food preferences (meal cards) and movement limitations (movement
 * moments) are safety/context facts — a read error must never become an empty
 * allergy list or a "safe" pick chosen without the limitations. On error the
 * route returns 503, calls no provider, releases the reservation and REFUNDS any
 * one-lifetime sample-adjustment claim it made.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  plan: { id: "11111111-1111-4111-8111-111111111111", plan_date: "2026-08-23", meal_cards: [] } as Row | null,
  planError: null as Row | null,
  profile: { allergies: ["peanuts"], movement_limitations: [] } as Row | null,
  profileError: null as Row | null,
  isPremium: true,
  sampleClaimable: true,
  providerCalls: 0,
  releaseCalls: [] as unknown[],
  refundCalls: 0,
}));

function from(table: string) {
  if (table === "daily_plans") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: h.plan, error: h.planError }) }),
        }),
      }),
      update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    };
  }
  if (table === "wellbeing_profiles") {
    return {
      update: (payload: Row) => ({
        eq: () => ({
          // claim path: .is(...).select(...).maybeSingle()
          is: () => ({
            select: () => ({
              maybeSingle: async () => ({
                data: h.sampleClaimable ? { user_id: "u1" } : null,
                error: null,
              }),
            }),
          }),
          // refund path: .eq("user_id", id) is awaited directly
          then: (resolve: (v: Row) => void) => {
            if (payload.sample_adjustment_used_at === null) h.refundCalls += 1;
            resolve({ error: null });
          },
        }),
      }),
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
vi.mock("@/lib/stripe/subscription", () => ({
  getUserSubscriptionStatus: async () => ({ isPremium: h.isPremium }),
}));
vi.mock("@/lib/today/mutation-guard", () => ({ checkPlanIsToday: async () => "ok" }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));
vi.mock("@/lib/safety/check-input", () => ({
  checkInputSafety: async () => ({ should_block_generation: false }),
}));

import { POST } from "@/app/api/ai/regenerate-section/route";

function req(body: Row) {
  return new Request("http://t/api/ai/regenerate-section", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const PLAN_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.plan = { id: PLAN_ID, plan_date: "2026-08-23", meal_cards: [] };
  h.planError = null;
  h.profile = { allergies: ["peanuts"], movement_limitations: [] };
  h.profileError = null;
  h.isPremium = true;
  h.sampleClaimable = true;
  h.providerCalls = 0;
  h.releaseCalls = [];
  h.refundCalls = 0;
});

describe("regenerate-section fails closed on required-read errors (WS-A)", () => {
  it("plan query error → 503 data_unavailable, no provider, reservation released", async () => {
    h.planError = { message: "db down" };
    const res = await POST(req({ plan_id: PLAN_ID, section_name: "meal_card", meal_type: "lunch", reason: "different_meals" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("data_unavailable");
    expect(h.providerCalls).toBe(0);
    expect(h.releaseCalls).toContain("evt-1");
  });

  it("meal profile error (premium) → 503, no provider, premium reservation released", async () => {
    h.profileError = { message: "db down" };
    const res = await POST(req({ plan_id: PLAN_ID, section_name: "meal_card", meal_type: "lunch", reason: "different_meals" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("data_unavailable");
    expect(h.providerCalls).toBe(0);
    expect(h.releaseCalls).toContain("evt-1");
  });

  it("sample tier: profile error → 503 BEFORE the claim, allowance never consumed", async () => {
    // v22: the one-lifetime claim now happens after every fail-closed read, so a
    // profile outage returns 503 before any claim exists — the allowance is
    // untouched (nothing to refund) rather than claimed-then-refunded.
    h.isPremium = false; // sample tier
    h.profileError = { message: "db down" };
    const res = await POST(req({ plan_id: PLAN_ID, section_name: "movement_moment", reason: "make_easier" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("data_unavailable");
    expect(h.providerCalls).toBe(0);
    expect(h.releaseCalls).toContain("evt-1");
    expect(h.refundCalls).toBe(0); // no claim was made, so nothing is refunded
  });

  it("verified-absent profile → 400 onboarding_required, no provider", async () => {
    h.profile = null;
    const res = await POST(req({ plan_id: PLAN_ID, section_name: "meal_card", meal_type: "lunch", reason: "different_meals" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("onboarding_required");
    expect(h.providerCalls).toBe(0);
  });
});
