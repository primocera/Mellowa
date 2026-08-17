import type { CohortScorecard, CohortRow } from "@/lib/analytics/cohort";
import type { DiscoveryVerdict } from "@/lib/pricing/discovery-gate";
import type { ObservabilityReport } from "@/lib/observability/report";

/**
 * MW-06 (v20): ONE canonical scale decision.
 *
 * The legacy `expansionVerdict` could return canExpand=true from a single
 * later-day return signal over a 28-day window, while `pricingDiscovery` and
 * `observability.scaleReady` were computed separately and never constrained it.
 * This function is the single authority: it combines recurring-value gates,
 * support burden, pricing discovery, operational/capacity readiness, data
 * freshness, billing incidents, cohort cap state and owner/release gates under a
 * strict PRECEDENCE — no averaging. Unavailable, immature, suppressed and stale
 * all mean WAIT, never pass. Thresholds are predeclared and never retuned here.
 */

export type ScaleVerdict =
  | "STOP"
  | "HOLD"
  | "BLOCK"
  | "PAUSE_INTAKE"
  | "INTERVIEW"
  | "ITERATE"
  | "SMALL_BOUNDED_EXPANSION";

export type GateStatus = "pass" | "fail" | "unavailable" | "immature";

export interface ScaleGate {
  id: string;
  status: GateStatus;
  detail: string;
}

export interface ScaleDecision {
  verdict: ScaleVerdict;
  /** true ONLY for SMALL_BOUNDED_EXPANSION. */
  canExpand: boolean;
  /** The single dominant blocker, or null when expansion is allowed. */
  blocker: string | null;
  reasons: string[];
  gates: ScaleGate[];
  nextAction: string;
}

export interface ScaleDecisionInput {
  cohort: CohortScorecard;
  pricingDiscovery: DiscoveryVerdict;
  observability: ObservabilityReport;
  /** True when the analytics window is stale (an outage/quiet window). */
  dataStale: boolean;
  /** Server-authoritative dispute count in window (null = unavailable). */
  disputes: number | null;
  /** Whether the invited cohort cap has been reached. */
  betaCapReached?: boolean;
  /**
   * Owner/release gates (immutable RC promoted, paid readiness observed, live
   * rehearsals complete). Defaults to false: real-world expansion stays blocked
   * until the owner attaches this evidence — never inferred from code/tests.
   */
  releaseGatesPassed?: boolean;
}

/** Predeclared value thresholds (never retuned after data is seen). */
export const SCALE_VALUE_GATES = {
  d2_return: 0.4,
  d3_return: 0.3,
  week_closeout_completed: 0.25,
  carry_forward_accepted: 0.5,
  trial_converted: 0.4, // trial-to-charge
  first_renewal: 0.7,
  refund_max: 0.05,
} as const;

function rowById(cohort: CohortScorecard, id: string): CohortRow | undefined {
  return cohort.rows.find((r) => r.id === id);
}

/** A rate gate: measured & meets threshold → pass; measured & below → fail;
 * pending/unavailable/suppressed → immature/unavailable. */
function rateGate(
  cohort: CohortScorecard,
  id: string,
  min: number
): ScaleGate {
  const row = rowById(cohort, id);
  if (!row) return { id, status: "unavailable", detail: `${id} not computed` };
  if (row.state === "unavailable")
    return { id, status: "unavailable", detail: `${id} unavailable` };
  if (row.state === "pending" || row.suppressed || row.rate === null)
    return { id, status: "immature", detail: `${id} not yet mature` };
  if (row.rate >= min) return { id, status: "pass", detail: `${id} ${pct(row.rate)} ≥ ${pct(min)}` };
  return { id, status: "fail", detail: `${id} ${pct(row.rate)} < ${pct(min)}` };
}

/** A "must have been observed on distinct days" gate (repeat repair). */
function observedGate(cohort: CohortScorecard, id: string): ScaleGate {
  const row = rowById(cohort, id);
  if (!row) return { id, status: "unavailable", detail: `${id} not computed` };
  if (row.state === "unavailable") return { id, status: "unavailable", detail: `${id} unavailable` };
  if (row.state === "pending") return { id, status: "immature", detail: `${id} not yet mature` };
  if ((row.numerator ?? 0) >= 1) return { id, status: "pass", detail: `${id} observed` };
  return { id, status: "fail", detail: `${id} never observed on distinct days` };
}

/** A "must stay at/below a max" gate (refunds). */
function maxGate(cohort: CohortScorecard, id: string, max: number): ScaleGate {
  const row = rowById(cohort, id);
  if (!row) return { id, status: "unavailable", detail: `${id} not computed` };
  if (row.state === "unavailable") return { id, status: "unavailable", detail: `${id} unavailable` };
  if (row.state === "pending" || row.rate === null)
    return { id, status: "immature", detail: `${id} not yet mature` };
  if (row.rate <= max) return { id, status: "pass", detail: `${id} ${pct(row.rate)} ≤ ${pct(max)}` };
  return { id, status: "fail", detail: `${id} ${pct(row.rate)} > ${pct(max)}` };
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

export function scaleDecision(input: ScaleDecisionInput): ScaleDecision {
  const { cohort, pricingDiscovery, observability } = input;

  // The value gates (all required, mature denominators).
  const gates: ScaleGate[] = [
    rateGate(cohort, "d2_return", SCALE_VALUE_GATES.d2_return),
    rateGate(cohort, "d3_return", SCALE_VALUE_GATES.d3_return),
    observedGate(cohort, "repeat_repair_distinct_day"),
    rateGate(cohort, "week_closeout_completed", SCALE_VALUE_GATES.week_closeout_completed),
    rateGate(cohort, "carry_forward_accepted", SCALE_VALUE_GATES.carry_forward_accepted),
    rateGate(cohort, "trial_converted", SCALE_VALUE_GATES.trial_converted),
    rateGate(cohort, "first_renewal", SCALE_VALUE_GATES.first_renewal),
    maxGate(cohort, "refund", SCALE_VALUE_GATES.refund_max),
  ];

  const reasons: string[] = [];
  const decide = (
    verdict: ScaleVerdict,
    blocker: string | null,
    reason: string,
    nextAction: string
  ): ScaleDecision => {
    reasons.push(reason);
    return { verdict, canExpand: verdict === "SMALL_BOUNDED_EXPANSION", blocker, reasons, gates, nextAction };
  };

  // 1. Safety / privacy / billing incident → STOP.
  const disputeRow = rowById(cohort, "dispute");
  const disputeCount = input.disputes ?? disputeRow?.numerator ?? null;
  if (disputeCount != null && disputeCount > 0) {
    return decide("STOP", "dispute", "A payment dispute is present; any dispute is a stop.", "Resolve the dispute and reconcile billing before any expansion.");
  }
  if (pricingDiscovery.risksPresent.includes("unresolved_safety_billing_deletion")) {
    return decide("STOP", "unresolved_incident", "An unresolved safety/billing/deletion issue is open.", "Resolve the open safety/billing/deletion issue first.");
  }

  // 2. Data / release / capacity unavailable → HOLD/BLOCK.
  if (input.dataStale) {
    return decide("HOLD", "data_stale", "The analytics window is stale; evidence cannot be trusted.", "Wait for fresh data before deciding.");
  }
  // Operational readiness: unavailable capacity/SLOs → HOLD; a measured breach → PAUSE INTAKE.
  if (!observability.scaleReady) {
    const breached = /breach|over budget|exceeded/i.test(observability.blockingReasons.join(" "));
    if (breached) {
      return decide("PAUSE_INTAKE", "operational_breach", `Operational breach: ${observability.blockingReasons.join("; ")}`, "Pause intake and fix the breached SLO/budget.");
    }
    return decide("BLOCK", "scale_readiness_unavailable", `Scale readiness not established: ${observability.blockingReasons.join("; ")}`, "Measure the unavailable capacity/SLOs the observability report names.");
  }
  if (input.releaseGatesPassed !== true) {
    return decide("HOLD", "owner_gates_not_passed", "Release/owner gates (RC, paid readiness, live rehearsals) are not attached.", "Complete the owner release gates and attach evidence.");
  }

  // 3. Value evidence: immature/unavailable → HOLD; measured-but-weak → ITERATE/INTERVIEW.
  const immature = gates.filter((g) => g.status === "immature" || g.status === "unavailable");
  if (immature.length > 0) {
    return decide("HOLD", "immature_evidence", `Value evidence is not mature: ${immature.map((g) => g.id).join(", ")}.`, "Wait for the named cohorts to mature; unavailable means wait, never zero.");
  }
  const weak = gates.filter((g) => g.status === "fail");
  if (weak.length > 0) {
    // A single weak carry-forward/return is an iterate-one-variable signal.
    return decide("ITERATE", "weak_value", `Mature but weak: ${weak.map((g) => g.detail).join("; ")}.`, "Interview or iterate ONE variable in the daily loop; do not widen intake yet.");
  }

  // 4. Pricing discovery must be open (MW-06 rule: pricingDiscovery false forces
  //    canExpand=false) and support must be verified within the ceiling.
  if (!pricingDiscovery.canRecommendPriceChange) {
    return decide("HOLD", "pricing_discovery_closed", `Pricing discovery is not ready: ${[...pricingDiscovery.requiredButMissing, ...pricingDiscovery.risksPresent].join(", ") || "not established"}.`, "Mature the pricing-discovery evidence (support ingestion, cohorts) before expansion.");
  }

  // 5. Cap state: never auto-grow.
  if (input.betaCapReached === true) {
    return decide("HOLD", "cap_reached", "The invited cohort cap is reached; growth is a manual owner decision.", "Owner manually raises the cap by a small bounded increment if desired.");
  }

  // 6. All gates pass, evidence mature, operations ready, owner gates attached.
  return decide(
    "SMALL_BOUNDED_EXPANSION",
    null,
    "All value gates are mature and pass, operations are ready, pricing discovery is open, no disputes, and owner gates are attached.",
    "Increase the invited cap by ONE small bounded increment; re-measure before the next step."
  );
}
