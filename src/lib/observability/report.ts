import { evaluateAll, SLOS, type SloEvaluation } from "@/lib/observability/slo";
import {
  evaluateBudgets,
  capacityAt10x,
  type BudgetEvaluation,
} from "@/lib/perf/budget";

/**
 * MW-13: turn the SLO and perf-budget catalogs into a live scale-readiness
 * verdict. Observed values come from real telemetry where it exists; anything
 * not yet instrumented is UNAVAILABLE, never a silent pass — and an unavailable
 * or breached CRITICAL journey blocks scale. Pure: the caller supplies the
 * already-fetched observations.
 */

export interface CapacityReport {
  available: boolean;
  projected: number | null;
  fits: boolean | null;
  headroom: number | null;
  /** What an operator must measure when capacity is unavailable. */
  note: string;
}

export interface ObservabilityReport {
  slos: SloEvaluation[];
  budgets: BudgetEvaluation[];
  capacity: CapacityReport;
  /** True only when every critical SLO is measured and clear, budgets are within,
   *  and capacity fits — otherwise scale is not supported. */
  scaleReady: boolean;
  /** Human reasons scale is blocked (breached/unavailable SLOs, over budgets, …). */
  blockingReasons: string[];
}

export interface ObservabilityInput {
  /** sloId → observed value (null/undefined ⇒ unavailable). */
  observedSlos: Record<string, number | null | undefined>;
  /** budgetId → observed value (null/undefined ⇒ unavailable). */
  observedBudgets: Record<string, number | null | undefined>;
  /** null ⇒ provider ceiling unknown ⇒ capacity unavailable. */
  capacity?: { expectedPeakConcurrent: number; providerCeiling: number } | null;
}

export function buildObservability(input: ObservabilityInput): ObservabilityReport {
  const slos = evaluateAll(input.observedSlos);
  const budgets = evaluateBudgets(input.observedBudgets);

  const blockingReasons: string[] = [];
  const ownerById = new Map(SLOS.map((s) => [s.id, s]));
  for (const e of slos) {
    // Every SLO journey is critical (see REQUIRED_JOURNEYS): breached or
    // unavailable blocks scale.
    if (e.state === "breached" || e.state === "unavailable") {
      const s = ownerById.get(e.id);
      blockingReasons.push(`SLO ${e.id} ${e.state}${s ? ` (owner: ${s.owner})` : ""}`);
    }
  }
  for (const b of budgets) {
    if (b.state === "over" || b.state === "unavailable") {
      blockingReasons.push(`budget ${b.id} ${b.state}`);
    }
  }

  let capacity: CapacityReport;
  if (!input.capacity) {
    capacity = {
      available: false,
      projected: null,
      fits: null,
      headroom: null,
      note: "Provider concurrency ceiling not measured — owner must load-test peak concurrent generations before scaling.",
    };
    blockingReasons.push("capacity unavailable (provider ceiling unmeasured)");
  } else {
    const c = capacityAt10x(input.capacity);
    capacity = {
      available: true,
      projected: c.projected,
      fits: c.fits,
      headroom: c.headroom,
      note: c.fits
        ? "10x projected peak fits the measured provider ceiling."
        : "10x projected peak exceeds the provider ceiling — do not scale.",
    };
    if (!c.fits) blockingReasons.push("capacity: 10x projection exceeds provider ceiling");
  }

  return {
    slos,
    budgets,
    capacity,
    scaleReady: blockingReasons.length === 0,
    blockingReasons,
  };
}
