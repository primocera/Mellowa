import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fairUseState,
  monthlyGenerationCap,
  syntheticMonthlyCostUsd,
  USAGE_MIXES,
} from "@/lib/ai/fair-use";
import { usageScorecard, type UsageRow } from "@/lib/analytics/metrics";
import { entitlementFor } from "@/lib/stripe/plans";

/**
 * MW-V9-10: fair-use policy, synthetic cost, admin cost scorecard and the
 * billing-state entitlement matrix. Protects Premium economics without silently
 * changing entitlements or claiming "unlimited".
 */

describe("fair-use policy is explicit and bounded", () => {
  it("has a generous default cap well above heavy use", () => {
    expect(monthlyGenerationCap()).toBe(300);
    // Heavy use ~90/month must sit comfortably inside the cap.
    expect(monthlyGenerationCap()).toBeGreaterThan(90 * 2);
  });

  it("classifies within-budget, soft-warn and over-cap states", () => {
    expect(fairUseState(10, 100).withinBudget).toBe(true);
    expect(fairUseState(10, 100).softWarn).toBe(false);
    expect(fairUseState(85, 100).softWarn).toBe(true); // ≥80%
    expect(fairUseState(85, 100).withinBudget).toBe(true);
    const over = fairUseState(100, 100);
    expect(over.withinBudget).toBe(false);
    expect(over.remaining).toBe(0);
  });
});

describe("synthetic monthly cost model", () => {
  it("orders light < typical < high and folds in retries + safety checks", () => {
    const light = syntheticMonthlyCostUsd(USAGE_MIXES.light);
    const typical = syntheticMonthlyCostUsd(USAGE_MIXES.typical);
    const high = syntheticMonthlyCostUsd(USAGE_MIXES.high);
    expect(light).toBeGreaterThan(0);
    expect(typical).toBeGreaterThan(light);
    expect(high).toBeGreaterThan(typical);
  });
});

describe("admin usage scorecard", () => {
  const rows: UsageRow[] = [
    ...Array.from({ length: 5 }, () => ({ user_id: "a", status: "success", estimated_cost_usd: 0.02 })),
    ...Array.from({ length: 100 }, () => ({ user_id: "b", status: "success", estimated_cost_usd: 0.02 })),
    { user_id: "c", status: "released", estimated_cost_usd: 0.02 }, // never counts
    { user_id: null, status: "success", estimated_cost_usd: 0.02 },
  ];

  it("counts generations per user, excludes released, flags high use", () => {
    const s = usageScorecard(rows, 3, 90);
    // Users a(5) and b(100); c is released-only so not an active user.
    expect(s.activeUsers).toBe(2);
    expect(s.highUseUsers).toBe(1); // only b ≥ 90
    expect(s.generationsP90).toBe(100);
    expect(s.ceilingDenials).toBe(3);
    // released row contributes no generation but is excluded from cost too.
    expect(s.totalCostUsd).toBeCloseTo(0.02 * (5 + 100 + 1), 4);
  });

  it("empty input yields null percentiles, never a fabricated 0", () => {
    const s = usageScorecard([], 0);
    expect(s.generationsP50).toBeNull();
    expect(s.generationsP90).toBeNull();
    expect(s.activeUsers).toBe(0);
  });
});

describe("billing-state entitlement matrix is complete and correct", () => {
  it("locks new generation for every non-active state; read stays on", () => {
    // Active states can generate.
    for (const s of ["active", "trialing"]) {
      expect(entitlementFor(s).generate).toBe(true);
      expect(entitlementFor(s).read).toBe(true);
    }
    // Non-active states keep read but cannot generate new premium plans.
    for (const s of ["past_due", "unpaid", "canceled", "incomplete"]) {
      expect(entitlementFor(s).read).toBe(true);
      expect(entitlementFor(s).generate).toBe(false);
    }
    // Unknown/garbage fails closed (no generation).
    expect(entitlementFor("something_weird").generate).toBe(false);
    expect(entitlementFor(null).generate).toBe(false);
  });

  it("recoverable states offer checkout; terminal-locked ones don't", () => {
    expect(entitlementFor("canceled").checkout).toBe(true);
    expect(entitlementFor("incomplete").checkout).toBe(true);
    // past_due recovers via billing portal, not a fresh checkout.
    expect(entitlementFor("past_due").checkout).toBe(false);
  });
});

describe("monthly fair-use is atomic and rollback-safe", () => {
  const migration = readFileSync(
    "supabase/migrations/035_mellowa_v9_monthly_fair_use.sql",
    "utf8"
  );
  const rateLimit = readFileSync("src/lib/ai/rate-limit.ts", "utf8");
  const guard = readFileSync("src/lib/ai/guard.ts", "utf8");

  it("adds a per-month arg to the advisory-locked claim, service-role only", () => {
    expect(migration).toContain("p_per_month int");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("interval '30 days'");
    expect(migration).toMatch(/reason', 'month'/);
    expect(migration).toContain(
      "grant execute on function public.claim_ai_generation(uuid, text, int, int, int, numeric, numeric) to service_role"
    );
    // Released reservations don't count toward the monthly cap.
    expect(migration).toMatch(/status <> 'released'/);
  });

  it("the cap is flag-gated with an effectively-infinite disabled value", () => {
    expect(rateLimit).toContain('isFlagEnabled("monthly_fair_use")');
    expect(rateLimit).toContain("MONTHLY_CAP_DISABLED");
    expect(rateLimit).toContain("p_per_month");
  });

  it("the month denial is honest: what remains + retry, never an upsell", () => {
    expect(guard).toContain('scope: "month"');
    expect(guard).toMatch(/fair-use limit/i);
    expect(guard).toMatch(/stays available to view/i);
    const monthBlock = guard.slice(guard.indexOf('claim.scope === "month"'));
    expect(monthBlock.slice(0, 400)).not.toMatch(/upgrade|premium|trial/i);
  });
});
