import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The weekly-plan route must go through the shared guardAiRoute (operator
 * per-account kill switch + consent checkpoint + rate limit / global ceiling),
 * not call claimAiGeneration directly. A guard denial is returned as-is, closes
 * the idempotency attempt as failed and never reaches the provider; a pass uses
 * the guard's reserved eventId for the ledger.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  guardDenial: null as null | { status: number; body: Row },
  guardCalls: [] as Row[],
  finishCalls: [] as Row[],
  providerCalls: 0,
  finalizeCalls: [] as Row[],
  releaseCalls: [] as unknown[],
  order: [] as string[],
}));

function builder(result: Row) {
  const api: Row = {
    select: () => api,
    eq: () => api,
    gte: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: async () => result,
    single: async () => result,
    insert: () => api,
    then: (resolve: (v: Row) => void) => resolve({ data: [], error: null }),
  };
  return api;
}

function from(table: string) {
  if (table === "wellbeing_profiles") {
    return builder({ data: { allergies: [], allergies_severe: false }, error: null });
  }
  if (table === "weekly_plans") return builder({ data: { id: "week-1" }, error: null });
  return builder({ data: null, error: null });
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from,
  }),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  canUsePremiumFeature: async () => true,
  canGenerateWeeklyPlan: async () => true,
}));

vi.mock("@/lib/ai/guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    guardAiRoute: async (userId: string, opts: Row) => {
      h.guardCalls.push({ userId, ...opts });
      h.order.push("guard");
      if (h.guardDenial) return NextResponse.json(h.guardDenial.body, { status: h.guardDenial.status });
      return { eventId: "evt-weekly" };
    },
  };
});

vi.mock("@/lib/ai/rate-limit", () => ({
  claimAiGeneration: async () => {
    throw new Error("weekly-plan must not call claimAiGeneration directly");
  },
}));

vi.mock("@/lib/ai/idempotency", () => ({
  isValidIdempotencyKey: () => true,
  claimGenerationRequest: async () => ({ claimed: true, requestId: "req-1" }),
  finishGenerationRequest: async (_c: unknown, opts: Row) => {
    h.finishCalls.push(opts);
  },
}));

vi.mock("@/lib/safety/check-input", () => ({
  checkInputSafety: async () => {
    h.order.push("safety");
    return { should_block_generation: false };
  },
}));

vi.mock("@/lib/ai/generate-weekly-plan", () => ({
  generateWeeklyPlan: async () => {
    h.providerCalls += 1;
    return {
      weekly_focus: "Gentle week",
      meal_structure: [],
      shopping_list: [],
      movement_plan: [],
      stress_reset_plan: [],
      habit_plan: [],
      low_energy_backup_plan: [],
      weekly_review_questions: [],
    };
  },
}));

vi.mock("@/lib/ai/output-guards", () => ({
  checkWeeklyPlanOutput: () => ({ ok: true, reasons: [] }),
  correctiveInstruction: () => "",
}));

vi.mock("@/lib/ai/usage", () => ({
  finalizeAiUsage: async (eventId: unknown, opts: Row) => {
    h.finalizeCalls.push({ eventId, ...opts });
  },
  releaseReservation: async (id: unknown) => {
    h.releaseCalls.push(id);
  },
  sumUsage: () => ({ status: "success" }),
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

import { POST } from "@/app/api/ai/weekly-plan/route";

function req(body: Row = { notes: "a calmer week please" }) {
  return new Request("http://t/api/ai/weekly-plan", {
    method: "POST",
    headers: { "x-idempotency-key": "weekly-key-0000001" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.guardDenial = null;
  h.guardCalls = [];
  h.finishCalls = [];
  h.providerCalls = 0;
  h.finalizeCalls = [];
  h.releaseCalls = [];
  h.order = [];
});

describe("weekly-plan uses the shared AI guard", () => {
  it("calls guardAiRoute for the weekly-plan route before safety classification", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.guardCalls).toHaveLength(1);
    expect(h.guardCalls[0]).toMatchObject({ userId: "u1", route: "weekly-plan" });
    expect(h.order.indexOf("guard")).toBeLessThan(h.order.indexOf("safety"));
    // The guard's reserved row is the one finalized.
    expect(h.finalizeCalls.at(-1)).toMatchObject({ eventId: "evt-weekly", status: "success" });
  });

  it("operator kill switch (403) → returned as-is, idempotency closed as failed, no provider", async () => {
    h.guardDenial = { status: 403, body: { error: "generation_unavailable" } };
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("generation_unavailable");
    expect(h.finishCalls.some((c) => c.status === "failed")).toBe(true);
    expect(h.providerCalls).toBe(0);
  });

  it("missing consent (403 consent_required) → no provider, idempotency closed", async () => {
    h.guardDenial = { status: 403, body: { error: "consent_required", missing: ["terms"] } };
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("consent_required");
    expect(h.providerCalls).toBe(0);
    expect(h.finishCalls.some((c) => c.status === "failed")).toBe(true);
  });

  it("rate limit (429) is surfaced from the guard unchanged", async () => {
    h.guardDenial = { status: 429, body: { error: "rate_limited", scope: "day" } };
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(h.providerCalls).toBe(0);
  });

  it("source no longer imports claimAiGeneration", () => {
    const src = readFileSync("src/app/api/ai/weekly-plan/route.ts", "utf8");
    expect(src).not.toMatch(/claimAiGeneration/);
    expect(src).toMatch(/guardAiRoute\(user\.id, \{ requirePremium: false, route: "weekly-plan" \}\)/);
  });
});
