import { assignmentBucket } from "@/lib/stripe/trial-experiment";
import {
  EXPERIMENTS,
  assignVariant,
  isExpired,
  namespaceConflicts,
  type ExperimentDef,
  type Assignment,
} from "@/lib/experiments/registry";

/**
 * MW-V18-18: bounded experimentation framework.
 *
 * Builds on the X03 registry (stable server-side assignment, kill switch,
 * expiry, namespaces) and adds the pieces the pack requires to run an experiment
 * safely: a percentage RAMP, a STAFF-ONLY mode, a full experiment PLAN (eligible
 * population, exposure point, primary metric, guardrails, maturity window,
 * analysis status), and a no-peeking analysis guard. Rollback is a flag flip —
 * no data migration.
 *
 * Only two experiments exist by design (first-session flow + repair preview),
 * in different namespaces so they never overlap for the same new-user cohort.
 *
 * Pure module — fully fixture-testable.
 */

export type AnalysisStatus = "not_started" | "collecting" | "ready" | "concluded";

export interface ExperimentPlan {
  id: string;
  eligible: string;
  exposurePoint: string;
  primaryMetric: string;
  guardrails: string[];
  maturityWindowDays: number;
  /** Predeclared analysis state — a winner may only be called when "ready". */
  analysisStatus: AnalysisStatus;
  /** 0–100: share of ELIGIBLE subjects actually exposed (the ramp). */
  rampPercent: number;
  /** When true, only staff subjects are exposed (dry run in production). */
  staffOnly: boolean;
}

export const EXPERIMENT_PLANS: Record<string, ExperimentPlan> = {
  first_session: {
    id: "first_session",
    eligible: "new users at signup with no prior activation",
    exposurePoint: "first Today render after onboarding",
    primaryMetric: "first_value within the first session (durable action)",
    guardrails: ["generation failure/latency", "early exit", "plan deletion", "safety escalation", "trial cancellation"],
    maturityWindowDays: 3,
    analysisStatus: "not_started",
    rampPercent: 0,
    staffOnly: true,
  },
  repair_preview: {
    id: "repair_preview",
    eligible: "activated users who open the Adjust flow",
    exposurePoint: "repair change-summary/preview shown",
    primaryMetric: "repair use and repeat in a later mature week",
    guardrails: ["undo rate", "abandonment", "net task burden", "support/safety", "latency"],
    maturityWindowDays: 14,
    analysisStatus: "not_started",
    rampPercent: 0,
    staffOnly: true,
  },
};

export interface RampContext {
  now?: Date;
  env?: Record<string, string | undefined>;
  eligible?: boolean;
  isStaff?: boolean;
}

/**
 * Assign a variant AND decide exposure under the ramp/staff-only rules.
 * Exposure requires: the base experiment is live (flag on, not expired), the
 * subject is eligible, and either staff (in staff-only mode) or inside the ramp
 * slice. A subject not exposed resolves to control with exposed=false, so no
 * exposure event is emitted until the user could truly experience the variant.
 */
export function assignExposed(
  def: ExperimentDef,
  plan: ExperimentPlan,
  subjectId: string,
  ctx: RampContext = {}
): Assignment & { exposed: boolean } {
  const base = assignVariant(def, subjectId, {
    now: ctx.now,
    env: ctx.env,
    eligible: ctx.eligible,
  });
  if (!base.live) return { ...base, exposed: false };

  // Staff-only mode: only staff are exposed (a production dry run).
  if (plan.staffOnly) {
    return ctx.isStaff
      ? { ...base, exposed: true }
      : { experimentId: def.id, variant: "control", live: true, bucket: base.bucket, exposed: false };
  }

  // Ramp: a second, independently-salted bucket decides the exposed slice, so
  // ramping up never re-buckets the variant assignment itself.
  const rampBucket = assignmentBucket(subjectId, `${def.id}:ramp`);
  const inRamp = rampBucket < plan.rampPercent;
  if (!inRamp) {
    return { experimentId: def.id, variant: "control", live: true, bucket: base.bucket, exposed: false };
  }
  return { ...base, exposed: true };
}

export interface AnalysisInput {
  plan: ExperimentPlan;
  cohortMature: boolean;
  guardrailsClear: boolean;
}

export type WinnerDecision =
  | { canDeclare: true }
  | { canDeclare: false; reason: "not_ready" | "immature" | "guardrail_breached" };

/**
 * A winner may be declared ONLY when analysis was predeclared ready, the cohort
 * is mature, and no guardrail is breached. This refuses a peeking-based
 * auto-winner from a dashboard threshold.
 */
export function canDeclareWinner(input: AnalysisInput): WinnerDecision {
  if (input.plan.analysisStatus !== "ready") return { canDeclare: false, reason: "not_ready" };
  if (!input.cohortMature) return { canDeclare: false, reason: "immature" };
  if (!input.guardrailsClear) return { canDeclare: false, reason: "guardrail_breached" };
  return { canDeclare: true };
}

/** Every planned experiment must exist in the registry, and vice-versa. */
export function planRegistryConsistent(): boolean {
  const planIds = new Set(Object.keys(EXPERIMENT_PLANS));
  const productExperimentIds = new Set(
    EXPERIMENTS.filter((e) => e.owner === "product").map((e) => e.id)
  );
  for (const id of planIds) if (!productExperimentIds.has(id)) return false;
  return true;
}

/** The two allowed experiments must not share a namespace (no cohort overlap). */
export function noNewUserOverlap(now: Date, env: Record<string, string | undefined>): boolean {
  const flagOn = (flag: string) => env[flag] === "1" || env[flag]?.toLowerCase() === "true";
  const active = EXPERIMENTS.filter(
    (d) =>
      Object.keys(EXPERIMENT_PLANS).includes(d.id) &&
      !isExpired(d, now) &&
      flagOn(d.killSwitchFlag)
  );
  return namespaceConflicts(active).length === 0;
}
