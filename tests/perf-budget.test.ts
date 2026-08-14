import { describe, expect, it } from "vitest";
import {
  PERF_BUDGETS,
  REQUIRED_BUDGET_JOURNEYS,
  evaluateBudget,
  evaluateBudgets,
  capacityAt10x,
} from "@/lib/perf/budget";

/**
 * MW-V18-X05: perf/cost budgets are machine-checked. Over budget = breach; an
 * unmeasured metric is UNAVAILABLE (never a silent pass). CWV budgets use the
 * standard "good" thresholds, and a 10x capacity check is explicit.
 */

describe("budget catalog", () => {
  it("covers every required journey and uses CWV good thresholds", () => {
    const journeys = new Set(PERF_BUDGETS.map((b) => b.journey));
    for (const j of REQUIRED_BUDGET_JOURNEYS) expect(journeys.has(j), j).toBe(true);
    expect(PERF_BUDGETS.find((b) => b.id === "lcp_today")!.budget).toBe(2500);
    expect(PERF_BUDGETS.find((b) => b.id === "cls_today")!.budget).toBe(0.1);
    expect(PERF_BUDGETS.find((b) => b.id === "inp_today")!.budget).toBe(200);
  });

  it("has unique ids", () => {
    expect(new Set(PERF_BUDGETS.map((b) => b.id)).size).toBe(PERF_BUDGETS.length);
  });
});

describe("evaluation", () => {
  const lcp = PERF_BUDGETS.find((b) => b.id === "lcp_today")!;

  it("within vs over budget", () => {
    expect(evaluateBudget(lcp, 2000).state).toBe("within");
    expect(evaluateBudget(lcp, 3200).state).toBe("over");
  });

  it("an unmeasured metric is unavailable, not a pass", () => {
    expect(evaluateBudget(lcp, null).state).toBe("unavailable");
    expect(evaluateBudget(lcp, undefined).state).toBe("unavailable");
    const all = evaluateBudgets({});
    expect(all.every((e) => e.state === "unavailable")).toBe(true);
  });

  it("cost budget flags an over-spend per activated user", () => {
    const cost = PERF_BUDGETS.find((b) => b.id === "ai_cost_per_activated")!;
    expect(evaluateBudget(cost, 0.3).state).toBe("within");
    expect(evaluateBudget(cost, 0.9).state).toBe("over");
  });
});

describe("10x capacity check", () => {
  it("projects 10x peak and reports fit + headroom", () => {
    expect(capacityAt10x({ expectedPeakConcurrent: 5, providerCeiling: 100 })).toEqual({
      projected: 50,
      fits: true,
      headroom: 50,
    });
    const tight = capacityAt10x({ expectedPeakConcurrent: 15, providerCeiling: 100 });
    expect(tight.fits).toBe(false);
    expect(tight.headroom).toBe(-50);
  });
});
