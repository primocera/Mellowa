import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildObservability } from "@/lib/observability/report";
import { SLOS } from "@/lib/observability/slo";
import { PERF_BUDGETS } from "@/lib/perf/budget";

/**
 * MW-13: the SLO + perf-budget catalogs drive a live scale-readiness verdict.
 * Unmeasured signals are UNAVAILABLE (never a silent pass), and a breached or
 * unavailable critical journey — or unmeasured capacity — blocks scale.
 */

/** All SLOs/budgets clearly healthy/within, capacity fits. */
function allGood() {
  const observedSlos: Record<string, number> = {};
  for (const s of SLOS) {
    observedSlos[s.id] =
      s.kind === "success_rate" ? 1 : 0; // 1.0 rate, 0 for ceiling/latency/freshness
  }
  const observedBudgets: Record<string, number> = {};
  for (const b of PERF_BUDGETS) observedBudgets[b.id] = 0; // well within every ceiling
  return { observedSlos, observedBudgets, capacity: { expectedPeakConcurrent: 5, providerCeiling: 100 } };
}

describe("buildObservability scale-readiness", () => {
  it("is scale-ready when everything is measured and clear", () => {
    const r = buildObservability(allGood());
    expect(r.scaleReady).toBe(true);
    expect(r.blockingReasons).toEqual([]);
    expect(r.capacity.available).toBe(true);
    expect(r.capacity.fits).toBe(true);
  });

  it("a breached critical SLO blocks scale and is named", () => {
    const g = allGood();
    g.observedSlos["auth_success"] = 0.5; // below the 0.99 target → breached
    const r = buildObservability(g);
    expect(r.scaleReady).toBe(false);
    expect(r.blockingReasons.some((x) => x.includes("auth_success"))).toBe(true);
  });

  it("an unavailable (unmeasured) SLO blocks scale, never a silent pass", () => {
    const g = allGood();
    delete g.observedSlos["generation_success"]; // unmeasured
    const r = buildObservability(g);
    expect(r.scaleReady).toBe(false);
    expect(r.blockingReasons.some((x) => x.includes("generation_success"))).toBe(true);
  });

  it("a budget over ceiling blocks scale", () => {
    const g = allGood();
    g.observedBudgets["ai_cost_per_activated"] = 999; // way over 0.5 USD
    const r = buildObservability(g);
    expect(r.scaleReady).toBe(false);
    expect(r.blockingReasons.some((x) => x.includes("ai_cost_per_activated"))).toBe(true);
  });

  it("unmeasured capacity is unavailable and blocks scale with an owner action", () => {
    const g = allGood();
    const r = buildObservability({ ...g, capacity: null });
    expect(r.capacity.available).toBe(false);
    expect(r.scaleReady).toBe(false);
    expect(r.capacity.note).toMatch(/load-test|measure/i);
  });

  it("a 10x projection over the provider ceiling blocks scale", () => {
    const g = allGood();
    const r = buildObservability({ ...g, capacity: { expectedPeakConcurrent: 20, providerCeiling: 100 } });
    expect(r.capacity.fits).toBe(false); // 20*10 = 200 > 100
    expect(r.scaleReady).toBe(false);
  });
});

describe("the analytics report wires the evaluators to real telemetry", () => {
  const report = readFileSync("src/lib/analytics/report.ts", "utf8");
  it("computes observability from live sources and returns it", () => {
    expect(report).toContain("buildObservability(");
    expect(report).toContain("observability");
    // AI unit cost from economics, deletion backlog from the stats RPC.
    expect(report).toContain("aiCostPerActivated");
    expect(report).toContain("account_deletion_stats");
  });
  it("the admin surfaces scale readiness", () => {
    const admin = readFileSync("src/app/admin/page.tsx", "utf8");
    expect(admin).toMatch(/Scale readiness/i);
    expect(admin).toContain("r.observability.scaleReady");
  });
});
