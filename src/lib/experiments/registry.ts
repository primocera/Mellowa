import { assignmentBucket } from "@/lib/stripe/trial-experiment";

/**
 * MW-V18-X03: the minimum trustworthy experimentation layer.
 *
 * One registry of experiment DEFINITIONS with stable server-side assignment,
 * versioned definitions, mutually-exclusive namespaces, delayed exposure, a kill
 * switch and an expiry. Assignment is deterministic from (experiment id +
 * version + subject id) using the same FNV-1a bucketing the trial experiment
 * uses — so a user never re-randomises across device or session, and bumping the
 * version starts a clean re-bucketing.
 *
 * Exposure is a SEPARATE step from assignment: a variant is assigned eagerly but
 * only "exposed" once the user could actually experience it, and exposure rides
 * the existing `experiment` analytics slug (no PII, dedupe by user+experiment).
 *
 * Entitlement and security must NEVER depend on an experiment/flag — these
 * decide only which safe variant of a surface a user sees.
 *
 * Pure module (env passed in) so assignment and cleanup are fully testable.
 */

export type ExperimentNamespace = "onboarding" | "daily_loop" | "weekly_loop";

export interface VariantWeight {
  /** Variant key; "control" is implicit as the remainder and need not be listed. */
  key: string;
  /** Integer 0–100 share of subjects assigned to this variant. */
  weight: number;
}

export interface ExperimentDef {
  id: string;
  namespace: ExperimentNamespace;
  /** Bump to re-bucket cleanly; part of the assignment hash. */
  version: number;
  owner: "growth" | "product" | "billing";
  description: string;
  /** Env flag that, when off, forces everyone to control (kill switch). */
  killSwitchFlag: string;
  /** ISO date after which the experiment must be concluded and removed. */
  expiresAt: string;
  /** Non-control arms and their integer weights (sum with control must be 100). */
  variants: VariantWeight[];
}

type EnvLike = Record<string, string | undefined>;

/**
 * The live registry. Models the experiments that actually exist today; the
 * Mellowa first-session / repair-preview experiments are added by M18 against
 * this same contract.
 */
export const EXPERIMENTS: ExperimentDef[] = [
  {
    id: "trial_length",
    namespace: "onboarding",
    version: 1,
    owner: "billing",
    description: "3-day vs 7-day trial length; conversion + first renewal.",
    killSwitchFlag: "FLAG_TRIAL_LENGTH_EXPERIMENT",
    expiresAt: "2026-12-31",
    variants: [{ key: "week_beta", weight: 50 }],
  },
  {
    id: "yearly_emphasis",
    namespace: "onboarding",
    version: 1,
    owner: "billing",
    description: "Factual yearly best-value emphasis vs monthly-first.",
    killSwitchFlag: "FLAG_EMPHASIZE_YEARLY",
    expiresAt: "2026-12-31",
    variants: [{ key: "emphasize", weight: 50 }],
  },
  {
    // MW-V18-09: first-session flow — reaching first_value (a durable action, not
    // a screen view) in the first session and D2/D3 mature return. Default OFF.
    id: "first_session",
    namespace: "onboarding",
    version: 1,
    owner: "product",
    description: "Optimised first-session flow vs current; primary = first_value in session + D2/D3.",
    killSwitchFlag: "FLAG_FIRST_SESSION_EXPERIMENT",
    expiresAt: "2027-03-31",
    variants: [{ key: "optimised", weight: 50 }],
  },
];

const CONTROL = "control";

function flagOn(env: EnvLike, flag: string): boolean {
  const raw = env[flag];
  return raw === "1" || raw?.toLowerCase() === "true";
}

export function isExpired(def: ExperimentDef, now: Date): boolean {
  const t = Date.parse(`${def.expiresAt}T23:59:59Z`);
  return Number.isFinite(t) && now.getTime() > t;
}

export interface Assignment {
  experimentId: string;
  variant: string;
  /** True only when the experiment is live (flag on, not expired, eligible). */
  live: boolean;
  /** The bucket used, for auditability. */
  bucket: number;
}

/**
 * Deterministically assign a subject to a variant. When the experiment is killed
 * or expired, everyone resolves to control and `live` is false — the caller must
 * NOT emit an exposure for a non-live assignment (delayed/guarded exposure).
 */
export function assignVariant(
  def: ExperimentDef,
  subjectId: string,
  opts: { now?: Date; env?: EnvLike; eligible?: boolean } = {}
): Assignment {
  const now = opts.now ?? new Date();
  const env = opts.env ?? {};
  const bucket = assignmentBucket(subjectId, `${def.id}:v${def.version}`);
  const live = flagOn(env, def.killSwitchFlag) && !isExpired(def, now) && opts.eligible !== false;
  if (!live) {
    return { experimentId: def.id, variant: CONTROL, live: false, bucket };
  }
  // Walk the weighted arms; the remainder is control.
  let acc = 0;
  for (const v of def.variants) {
    acc += v.weight;
    if (bucket < acc) return { experimentId: def.id, variant: v.key, live: true, bucket };
  }
  return { experimentId: def.id, variant: CONTROL, live: true, bucket };
}

/**
 * The exposure fact to record ONLY when the user could actually experience the
 * variant. Rides the existing `experiment` analytics slug; dedupe by
 * (user + experiment) so a re-render never double-counts. No PII.
 */
export function exposureProperty(a: Assignment): { experiment?: string } {
  return a.live ? { experiment: `${a.experimentId}:${a.variant}` } : {};
}

/** Experiments live right now (flag on and not expired). */
export function activeExperiments(now: Date, env: EnvLike): ExperimentDef[] {
  return EXPERIMENTS.filter((d) => flagOn(env, d.killSwitchFlag) && !isExpired(d, now));
}

/** Namespaces with more than one live experiment — unattributable, needs action. */
export function namespaceConflicts(active: ExperimentDef[]): { namespace: string; ids: string[] }[] {
  const byNs = new Map<string, string[]>();
  for (const d of active) byNs.set(d.namespace, [...(byNs.get(d.namespace) ?? []), d.id]);
  return [...byNs.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([namespace, ids]) => ({ namespace, ids: ids.sort() }));
}

/** Experiments still switched ON past their expiry — the cleanup queue. */
export function expiredButEnabled(now: Date, env: EnvLike): ExperimentDef[] {
  return EXPERIMENTS.filter((d) => flagOn(env, d.killSwitchFlag) && isExpired(d, now));
}
