import "server-only";

/**
 * Minimal feature flags (Prompt 20). Env-driven so a feature can be turned
 * off in Vercel without a deploy: set FLAG_<NAME>=0|false to disable.
 * Everything defaults ON — flags are kill switches, not launch gates.
 */
export const KNOWN_FLAGS = [
  "weekly_plan",
  "journal_reflection",
  "meal_regeneration",
  "reminders",
  "fallback_plan",
  // v8 (MW-S10): experiment rollback switches — turning one off disables the
  // surface without touching stored data, so an experiment can be rolled back
  // without data corruption.
  "plan_repair",
  "weekly_reflection",
  // v9 (MW-V9-10): monthly fair-use abuse cap. Default ON; setting
  // FLAG_MONTHLY_FAIR_USE=0 makes the claim RPC apply an effectively-infinite
  // monthly cap, a zero-deploy rollback of the safeguard.
  "monthly_fair_use",
  // v18 (MW-V18-04): kill switch for the INLINE processing pass on account
  // deletion. Default ON = the API drives one pass in-request for fast
  // completion. Setting FLAG_ACCOUNT_DELETION_SYNC=0 makes deletion fully async
  // (durable job created, then only the cron worker drives it) — a zero-deploy
  // rollback if inline processing ever pressures request latency. Either way the
  // state machine is the single source of truth; this never spawns a second path.
  "account_deletion_sync",
] as const;

export type FeatureFlag = (typeof KNOWN_FLAGS)[number];

export function isFlagEnabled(flag: FeatureFlag): boolean {
  const raw = process.env[`FLAG_${flag.toUpperCase()}`];
  if (raw === undefined || raw === "") return true;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

/**
 * MW-V9-08: yearly-plan emphasis is OPT-IN and defaults OFF. Until retention
 * and unit economics justify it, pricing presents Monthly first and does not
 * aggressively steer to the Yearly plan. Set FLAG_EMPHASIZE_YEARLY=1 to turn on
 * a factual "best value" emphasis (the real saving is derived from the catalog,
 * ~16.6% at current amounts — see src/lib/stripe/plans.ts, never "50%"). This is
 * the inverse of the kill-switch flags above (default ON): the safe default is
 * no nudge.
 */
export function isYearlyEmphasisEnabled(): boolean {
  const raw = process.env.FLAG_EMPHASIZE_YEARLY;
  return raw === "1" || raw?.toLowerCase() === "true";
}
