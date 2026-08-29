import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * v22 — FREE SAMPLE CLAIM / REFUND CORRECTNESS (regenerate-section).
 *
 * The sample tier gets ONE lifetime curated (non-AI) section swap. The claim is
 * an atomic conditional update made AFTER every fail-closed read, immediately
 * before the only mutation. These tests prove the two failure modes the closure
 * pack targets cannot happen:
 *   1. a claim RPC *database error* is never reported as "sample already used"
 *      (it fails closed with 503, calls no provider and consumes no entitlement);
 *   2. a claim can never be silently lost after a failed compensation — the
 *      refund is verified and, when it cannot be confirmed, an explicit
 *      repairable state is returned instead of "nothing changed".
 * Idempotency: a retry after an ambiguous save never grants extra allowance.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  plan: { id: "11111111-1111-4111-8111-111111111111", plan_date: "2026-08-23", meal_cards: [] } as Row | null,
  profile: { allergies: [], movement_limitations: null, food_preferences: [] } as Row | null,
  isPremium: false,
  claimClaimable: true,
  claimError: null as Row | null,
  curatedError: null as Row | null,
  refundError: null as Row | null,
  providerCalls: 0,
  releaseCalls: [] as unknown[],
  claimCalls: 0,
  refundCalls: 0,
}));

function from(table: string) {
  if (table === "daily_plans") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: h.plan, error: null }) }),
        }),
      }),
      // curated save (and meal save) — awaited after .eq().eq()
      update: () => ({ eq: () => ({ eq: async () => ({ error: h.curatedError }) }) }),
    };
  }
  if (table === "wellbeing_profiles") {
    return {
      update: (payload: Row) => ({
        eq: () => ({
          // claim path: .is(...).select(...).maybeSingle()
          is: () => ({
            select: () => ({
              maybeSingle: async () => {
                h.claimCalls += 1;
                if (h.claimError) return { data: null, error: h.claimError };
                return { data: h.claimClaimable ? { user_id: "u1" } : null, error: null };
              },
            }),
          }),
          // refund path: .update({...:null}).eq("user_id", id) awaited directly
          then: (resolve: (v: Row) => void) => {
            if (payload.sample_adjustment_used_at === null) {
              h.refundCalls += 1;
              resolve({ error: h.refundError });
            } else {
              resolve({ error: null });
            }
          },
        }),
      }),
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: h.profile, error: null }) }),
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

const PLAN_ID = "11111111-1111-4111-8111-111111111111";

function req(body: Row) {
  return new Request("http://t/api/ai/regenerate-section", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function sampleSwap(overrides: Row = {}) {
  return req({ plan_id: PLAN_ID, section_name: "movement_moment", reason: "make_easier", ...overrides });
}

beforeEach(() => {
  h.plan = { id: PLAN_ID, plan_date: "2026-08-23", meal_cards: [] };
  h.profile = { allergies: [], movement_limitations: null, food_preferences: [] };
  h.isPremium = false;
  h.claimClaimable = true;
  h.claimError = null;
  h.curatedError = null;
  h.refundError = null;
  h.providerCalls = 0;
  h.releaseCalls = [];
  h.claimCalls = 0;
  h.refundCalls = 0;
});

describe("sample claim / refund correctness (v22)", () => {
  it("claim RPC error → 503 data_unavailable, NOT 'used', no provider, reservation released", async () => {
    h.claimError = { message: "db down" };
    const res = await POST(sampleSwap());
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error).toBe("data_unavailable");
    expect(body.error).not.toBe("sample_adjustment_used");
    expect(h.providerCalls).toBe(0);
    expect(h.releaseCalls).toContain("evt-1");
    expect(h.refundCalls).toBe(0); // nothing was claimed
  });

  it("claim already used (verified no-row) → 402 sample_adjustment_used, no provider", async () => {
    h.claimClaimable = false;
    const res = await POST(sampleSwap());
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body.error).toBe("sample_adjustment_used");
    expect(h.providerCalls).toBe(0);
    expect(h.releaseCalls).toContain("evt-1");
  });

  it("curated save failure after a committed claim → allowance refunded, 500 Failed to save", async () => {
    h.curatedError = { message: "write failed" };
    const res = await POST(sampleSwap());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to save section");
    expect(h.claimCalls).toBe(1);
    expect(h.refundCalls).toBe(1); // sample_adjustment_used_at set back to null
  });

  it("refund ALSO fails → explicit repairable state, never 'nothing changed'", async () => {
    h.curatedError = { message: "write failed" };
    h.refundError = { message: "refund write failed" };
    const res = await POST(sampleSwap());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("sample_claim_unresolved");
    expect(body.repairable).toBe(true);
    expect(h.refundCalls).toBe(1);
  });

  it("meal_card for a sample user → 402 premium_required BEFORE any claim (allowance untouched)", async () => {
    const res = await POST(req({ plan_id: PLAN_ID, section_name: "meal_card", meal_type: "lunch", reason: "different_meals" }));
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body.error).toBe("premium_required");
    expect(h.claimCalls).toBe(0); // never claimed for a blocked request
    expect(h.providerCalls).toBe(0);
  });

  it("happy path → 200 with sample_adjustment true, exactly one claim, no refund, no provider", async () => {
    const res = await POST(sampleSwap());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sample_adjustment).toBe(true);
    expect(h.claimCalls).toBe(1);
    expect(h.refundCalls).toBe(0);
    expect(h.providerCalls).toBe(0);
  });

  it("idempotent retry after an ambiguous save: refund returns allowance, a fresh retry can claim again", async () => {
    // First attempt: save fails, allowance is refunded (claim released).
    h.curatedError = { message: "write failed" };
    const first = await POST(sampleSwap());
    expect(first.status).toBe(500);
    expect(h.refundCalls).toBe(1);

    // Retry: the write now succeeds and the (refunded) allowance is claimable
    // again — the user is not double-charged their one lifetime sample.
    h.curatedError = null;
    const second = await POST(sampleSwap());
    const body = await second.json();
    expect(second.status).toBe(200);
    expect(body.sample_adjustment).toBe(true);
    expect(h.claimCalls).toBe(2); // one claim per attempt, never extra allowance
    expect(h.refundCalls).toBe(1); // second attempt succeeded — no further refund
  });
});
