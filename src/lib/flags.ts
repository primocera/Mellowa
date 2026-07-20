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
] as const;

export type FeatureFlag = (typeof KNOWN_FLAGS)[number];

export function isFlagEnabled(flag: FeatureFlag): boolean {
  const raw = process.env[`FLAG_${flag.toUpperCase()}`];
  if (raw === undefined || raw === "") return true;
  return raw !== "0" && raw.toLowerCase() !== "false";
}
