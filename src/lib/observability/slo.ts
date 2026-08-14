/**
 * MW-V18-X02: SLIs/SLOs for the critical journeys, as one machine-readable
 * catalog. Alerts and the incident runbook derive from this single source, so a
 * breach always names its owner and its runbook and can never drift from the
 * doc. Thresholds are deliberately modest for a small paid SaaS.
 */

export interface Slo {
  /** Stable id used by dashboards/alerts. */
  id: string;
  journey: string;
  /** The measured indicator. */
  sli: string;
  /** Target as a fraction (e.g. 0.99) or a latency ceiling in ms. */
  target: number;
  kind: "success_rate" | "latency_p95_ms" | "freshness_hours" | "count_ceiling";
  owner: "platform" | "product" | "billing";
  /** Repo-relative runbook a responder opens on breach. */
  runbook: string;
}

export const SLOS: Slo[] = [
  { id: "auth_success", journey: "authentication", sli: "sign-in success rate", target: 0.99, kind: "success_rate", owner: "platform", runbook: "docs/runbooks/incident-response.md" },
  { id: "generation_success", journey: "core generation", sli: "plan generation success (incl. fallback)", target: 0.98, kind: "success_rate", owner: "product", runbook: "docs/runbooks/ai-usage-health-queries.sql" },
  { id: "generation_latency", journey: "core generation", sli: "generation p95 latency", target: 12000, kind: "latency_p95_ms", owner: "product", runbook: "docs/runbooks/ai-usage-health-queries.sql" },
  { id: "persistence_success", journey: "persistence", sli: "plan/check-in write success rate", target: 0.999, kind: "success_rate", owner: "platform", runbook: "docs/runbooks/incident-response.md" },
  { id: "repair_success", journey: "export/repair", sli: "remaining-day repair commit success", target: 0.98, kind: "success_rate", owner: "product", runbook: "docs/runbooks/incident-response.md" },
  { id: "checkout_success", journey: "checkout", sli: "checkout session creation success", target: 0.98, kind: "success_rate", owner: "billing", runbook: "docs/runbooks/billing-order-test-clock.md" },
  { id: "webhook_processing", journey: "webhook processing", sli: "stripe webhook processed (non-dead-letter) rate", target: 0.99, kind: "success_rate", owner: "billing", runbook: "docs/runbooks/billing-order-test-clock.md" },
  { id: "entitlement_freshness", journey: "entitlement refresh", sli: "entitlement drift resolved within", target: 24, kind: "freshness_hours", owner: "billing", runbook: "docs/runbooks/billing-order-test-clock.md" },
  { id: "deletion_stuck", journey: "account deletion", sli: "deletion jobs stuck past retry ceiling", target: 0, kind: "count_ceiling", owner: "platform", runbook: "docs/runbooks/privacy-requests.md" },
];

/** The journeys X02 requires an SLO for; the contract test asserts coverage. */
export const REQUIRED_JOURNEYS = [
  "authentication",
  "core generation",
  "persistence",
  "export/repair",
  "checkout",
  "webhook processing",
  "entitlement refresh",
  "account deletion",
] as const;

export type SloState = "healthy" | "degraded" | "breached" | "unavailable";

export interface SloEvaluation {
  id: string;
  state: SloState;
  observed: number | null;
  target: number;
  runbook: string;
}

/**
 * Evaluate one SLO against an observed value. A null/undefined observation is
 * UNAVAILABLE (never silently healthy). For rates, below target is a breach and
 * within a 1% band above target is degraded; for ceilings/latency/freshness,
 * over target is a breach and within 20% is degraded.
 */
export function evaluateSlo(slo: Slo, observed: number | null | undefined): SloEvaluation {
  const base = { id: slo.id, target: slo.target, runbook: slo.runbook };
  if (observed === null || observed === undefined || !Number.isFinite(observed)) {
    return { ...base, state: "unavailable", observed: null };
  }
  if (slo.kind === "success_rate") {
    // Warning band: within half the remaining headroom above target is degraded
    // (barely clearing the line); comfortably above is healthy.
    const margin = (1 - slo.target) * 0.5;
    const state: SloState =
      observed < slo.target ? "breached" : observed < slo.target + margin ? "degraded" : "healthy";
    return { ...base, state, observed };
  }
  // latency_p95_ms | freshness_hours | count_ceiling: lower is better.
  const state: SloState =
    observed > slo.target ? "breached" : observed > slo.target * 0.8 ? "degraded" : "healthy";
  return { ...base, state, observed };
}

export function evaluateAll(observed: Record<string, number | null | undefined>): SloEvaluation[] {
  return SLOS.map((s) => evaluateSlo(s, observed[s.id]));
}
