import type { CohortScorecard, CohortRow } from "@/lib/analytics/cohort";
import type { SupportBurden } from "@/lib/support/metrics";

/**
 * MW-V18-15: the packaging discovery gate.
 *
 * A price/packaging change may only be RECOMMENDED once the canonical mature
 * cohorts actually support it. If the evidence is immature, suppressed or
 * unavailable, the honest output is "do not change price yet — instrument and
 * wait", never a guess. Read-only: this reads the M05 cohort scorecard and the
 * M08 support burden and makes a decision. It does NOT touch Stripe, prices, the
 * catalog or any billing code (billing is frozen).
 *
 * Pure module — fully fixture-testable.
 */

/** Cohort rows whose maturity must be proven before a pricing decision. */
export const REQUIRED_ROWS = [
  "d2_return",
  "d3_return",
  "repeat_repair_distinct_day",
  "week_closeout_completed",
  "carry_forward_accepted",
  "trial_converted",
  "first_renewal",
] as const;

/** Rows that must show NO problem signal (a present count blocks expansion). */
export const RISK_ROWS = ["refund", "dispute"] as const;

export interface DiscoveryInput {
  cohort: CohortScorecard;
  support: SupportBurden;
  /** Max acceptable support contacts per 100 activated users. */
  supportPer100Ceiling?: number;
}

export interface DiscoveryVerdict {
  canRecommendPriceChange: boolean;
  /** Human reasons the gate is open or closed. */
  reasons: string[];
  /** Metrics that must mature/clear before a decision — the research plan. */
  requiredButMissing: string[];
  /** Risk signals currently present (refund/dispute/support/unresolved). */
  risksPresent: string[];
}

const DEFAULT_SUPPORT_CEILING = 20; // contacts per 100 activated users

function rowById(cohort: CohortScorecard, id: string): CohortRow | undefined {
  return cohort.rows.find((r) => r.id === id);
}

/**
 * A required metric is "proven mature" only when it is measured (not pending),
 * not suppressed, and has a real numerator/denominator. Pending/suppressed/
 * unavailable all mean "not enough data yet" — the gate stays closed.
 */
function isMature(row: CohortRow | undefined): boolean {
  if (!row) return false;
  if (row.state !== "measured") return false;
  if (row.suppressed) return false;
  return row.denominator > 0 && row.numerator !== null;
}

export function discoveryGate(input: DiscoveryInput): DiscoveryVerdict {
  const reasons: string[] = [];
  const requiredButMissing: string[] = [];
  const risksPresent: string[] = [];
  const ceiling = input.supportPer100Ceiling ?? DEFAULT_SUPPORT_CEILING;

  // 1. Every required value/retention/monetisation metric must be mature.
  for (const id of REQUIRED_ROWS) {
    if (!isMature(rowById(input.cohort, id))) requiredButMissing.push(id);
  }

  // 2. Risk rows: a present refund/dispute count blocks a price change.
  for (const id of RISK_ROWS) {
    const row = rowById(input.cohort, id);
    if (row && row.state === "measured" && (row.numerator ?? 0) > 0) {
      risksPresent.push(id);
    }
  }

  // 3. Support burden must be measured and within the ceiling; unresolved
  //    safety/billing/deletion contacts block outright.
  if (input.support.state === "unavailable") {
    requiredButMissing.push("support_burden");
  } else {
    if (input.support.unresolvedCritical > 0) {
      risksPresent.push("unresolved_safety_billing_deletion");
    }
    const per100 = input.support.contactsPer100Activated;
    if (per100 === null) {
      requiredButMissing.push("support_burden_denominator");
    } else if (per100 > ceiling) {
      risksPresent.push(`support_load_${per100}_per_100_over_${ceiling}`);
    }
  }

  const canRecommendPriceChange =
    requiredButMissing.length === 0 && risksPresent.length === 0;

  if (canRecommendPriceChange) {
    reasons.push(
      "All required cohorts are mature and no risk signal is present — a packaging change may be evaluated on real evidence."
    );
  } else {
    if (requiredButMissing.length) {
      reasons.push(
        `Insufficient mature evidence (${requiredButMissing.length} metric(s) pending/suppressed/unavailable). Do NOT change price; instrument and wait for maturity.`
      );
    }
    if (risksPresent.length) {
      reasons.push(
        `Risk signals present (${risksPresent.join(", ")}) — resolve before any packaging change.`
      );
    }
  }

  return { canRecommendPriceChange, reasons, requiredButMissing, risksPresent };
}
