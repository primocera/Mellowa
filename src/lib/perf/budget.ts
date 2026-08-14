/**
 * MW-V18-X05: machine-checked performance & cost budgets.
 *
 * Explicit ceilings for the metrics that are stable enough to guard in code:
 * Core Web Vitals on the critical routes, API latency, AI unit cost, and the
 * concurrency/capacity caps. A measured value over budget is a breach; an
 * unmeasured value is UNAVAILABLE, never a silent pass. Field measurement of
 * CWV already flows through perf/web-vitals.ts (migration 041); the AI spend
 * ceiling and per-user caps live in ai/fair-use.ts + ai/rate-limit.ts.
 *
 * Pure module — the catalog and evaluator are fixture-testable.
 */

export type BudgetUnit = "ms" | "score" | "usd" | "count";

export interface PerfBudget {
  id: string;
  journey: string;
  metric: string;
  /** Ceiling; a measured value ABOVE this is a breach (lower is always better). */
  budget: number;
  unit: BudgetUnit;
}

/** Budgets derived from Core Web Vitals "good" thresholds + product need. */
export const PERF_BUDGETS: PerfBudget[] = [
  // Core Web Vitals (good thresholds) on the two highest-traffic routes.
  { id: "lcp_landing", journey: "landing", metric: "LCP", budget: 2500, unit: "ms" },
  { id: "cls_landing", journey: "landing", metric: "CLS", budget: 0.1, unit: "score" },
  { id: "inp_landing", journey: "landing", metric: "INP", budget: 200, unit: "ms" },
  { id: "lcp_today", journey: "today", metric: "LCP", budget: 2500, unit: "ms" },
  { id: "cls_today", journey: "today", metric: "CLS", budget: 0.1, unit: "score" },
  { id: "inp_today", journey: "today", metric: "INP", budget: 200, unit: "ms" },
  // API latency (server work, excluding the AI provider call).
  { id: "api_p95_read", journey: "persistence", metric: "read p95", budget: 500, unit: "ms" },
  { id: "api_p95_mutation", journey: "persistence", metric: "mutation p95", budget: 800, unit: "ms" },
  // AI unit economics — spend per activated user in the window.
  { id: "ai_cost_per_activated", journey: "generation", metric: "AI USD / activated user", budget: 0.5, unit: "usd" },
  // Capacity: concurrent generations per user (backpressure cap).
  { id: "concurrent_generations", journey: "generation", metric: "concurrent gens / user", budget: 2, unit: "count" },
];

/** The journeys a perf budget must exist for. */
export const REQUIRED_BUDGET_JOURNEYS = ["landing", "today", "persistence", "generation"] as const;

export type BudgetState = "within" | "over" | "unavailable";

export interface BudgetEvaluation {
  id: string;
  state: BudgetState;
  observed: number | null;
  budget: number;
  unit: BudgetUnit;
}

export function evaluateBudget(b: PerfBudget, observed: number | null | undefined): BudgetEvaluation {
  if (observed === null || observed === undefined || !Number.isFinite(observed)) {
    return { id: b.id, state: "unavailable", observed: null, budget: b.budget, unit: b.unit };
  }
  return {
    id: b.id,
    state: observed > b.budget ? "over" : "within",
    observed,
    budget: b.budget,
    unit: b.unit,
  };
}

export function evaluateBudgets(observed: Record<string, number | null | undefined>): BudgetEvaluation[] {
  return PERF_BUDGETS.map((b) => evaluateBudget(b, observed[b.id]));
}

/**
 * A 10x-beta capacity check: given expected peak concurrent generations and the
 * provider/instance ceiling, is there headroom at 10x? Returns the projected
 * load and whether it fits — an explicit assumption, not a guess.
 */
export function capacityAt10x(args: {
  expectedPeakConcurrent: number;
  providerCeiling: number;
}): { projected: number; fits: boolean; headroom: number } {
  const projected = args.expectedPeakConcurrent * 10;
  return {
    projected,
    fits: projected <= args.providerCeiling,
    headroom: args.providerCeiling - projected,
  };
}
