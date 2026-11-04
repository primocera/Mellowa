import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The curated static fallback plan (served on a provider outage) contains
 * specific meals. A severe / life-threatening allergy user — including one who
 * only set the onboarding flag `allergies_severe` and listed nothing — must get
 * the same meal-free plan the AI path gives them: the fallback's meals are
 * stripped, the severe-allergy boundary note is appended, and nothing is
 * persisted to generated_meal_cards.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  profile: { timezone: "UTC", allergies: [] as string[], allergies_severe: false } as Row,
  planInserts: [] as Row[],
  mealCardInserts: [] as unknown[],
  finalizeCalls: [] as Row[],
}));

function daily_plans_builder() {
  const api: Row = {
    select: () => api,
    eq: () => api,
    is: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: async () => ({ data: null, error: null }), // no canonical plan yet
    insert: (payload: Row) => {
      h.planInserts.push(payload);
      return {
        select: () => ({
          single: async () => ({ data: { id: "plan-1", ...payload }, error: null }),
        }),
      };
    },
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
  if (table === "generated_meal_cards") {
    return {
      insert: async (rows: unknown[]) => {
        h.mealCardInserts.push(...rows);
        return { error: null };
      },
    };
  }
  return generic_select();
}

async function rpc(name: string) {
  if (name === "claim_daily_plan_generation") {
    return {
      data: { outcome: "claimed", owner_request_id: "owner-1", attempt: 1, reclaimed: false },
      error: null,
    };
  }
  if (name === "claim_generation_request") {
    return { data: { claimed: true, request_id: "req-1" }, error: null };
  }
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from,
    rpc,
  }),
}));

// Provider outage: every generation attempt throws.
vi.mock("@/lib/ai/generate-daily-plan-v2", async () => {
  const { AiGenerationError } = await import("@/lib/ai/errors");
  return {
    generateDailyPlanV2: async () => {
      throw new AiGenerationError("provider down", "provider_error");
    },
  };
});

vi.mock("@/lib/ai/usage", () => ({
  finalizeAiUsage: async (_id: unknown, opts: Row) => {
    h.finalizeCalls.push(opts);
  },
  releaseReservation: async () => {},
}));

vi.mock("@/lib/ai/guard", () => ({ guardAiRoute: async () => ({ eventId: "evt-1" }) }));
vi.mock("@/lib/stripe/subscription", () => ({
  canGenerateDailyPlan: async () => true,
  getUserPlan: async () => "premium",
}));
vi.mock("@/lib/safety/check-input", () => ({
  checkInputSafety: async () => ({ should_block_generation: false, user_message: null }),
}));
vi.mock("@/lib/email/deliver", () => ({ deliverEmail: async () => {} }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

import { POST } from "@/app/api/ai/daily-plan/route";
import { SEVERE_ALLERGY_MESSAGE } from "@/lib/safety/allergens";

function req() {
  return new Request("http://t/api/ai/daily-plan", {
    method: "POST",
    headers: { "x-idempotency-key": "aaaaaaaa-severe-1" },
    body: JSON.stringify({ energy_level: 3, stress_level: 3 }),
  });
}

beforeEach(() => {
  h.profile = { timezone: "UTC", allergies: [], allergies_severe: false };
  h.planInserts = [];
  h.mealCardInserts = [];
  h.finalizeCalls = [];
});

describe("daily-plan static fallback honours a severe allergy", () => {
  it("flag-only severe user gets the fallback WITHOUT meals, and no meal cards are persisted", async () => {
    h.profile = { timezone: "UTC", allergies: [], allergies_severe: true };
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.planInserts).toHaveLength(1);
    const saved = h.planInserts[0];
    expect(saved.is_fallback).toBe(true);
    expect(saved.meal_cards).toEqual([]);
    expect(String(saved.safety_note)).toContain(SEVERE_ALLERGY_MESSAGE);
    expect(h.mealCardInserts).toHaveLength(0);
    expect(h.finalizeCalls.at(-1)?.status).toBe("fallback");
  });

  it("a user with no allergy at all still gets the fallback's meals", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    const saved = h.planInserts[0];
    expect(saved.is_fallback).toBe(true);
    expect((saved.meal_cards as unknown[]).length).toBeGreaterThan(0);
    expect(h.mealCardInserts.length).toBeGreaterThan(0);
  });

  it("a listed (non-severe) allergy still gets no fallback at all — 502", async () => {
    h.profile = { timezone: "UTC", allergies: ["peanuts"], allergies_severe: false };
    const res = await POST(req());
    expect(res.status).toBe(502);
    expect(h.planInserts).toHaveLength(0);
  });
});
