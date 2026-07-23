import "server-only";

/**
 * Minimal feature flags (Prompt 20). Env-driven so a feature can be turned
 * off in Vercel without a deploy: set FLAG_<NAME>=0|false to disable.
 * Everything defaults ON — flags are kill switches, not launch gates.
 */
const KNOWN_FLAGS = [
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
 * aggressively steer to the 50%-off Yearly plan. Set FLAG_EMPHASIZE_YEARLY=1
 * to turn on a factual "best value" emphasis. This is the inverse of the
 * kill-switch flags above (default ON): here the safe default is no nudge.
 */
export function isYearlyEmphasisEnabled(): boolean {
  const raw = process.env.FLAG_EMPHASIZE_YEARLY;
  return raw === "1" || raw?.toLowerCase() === "true";
}
