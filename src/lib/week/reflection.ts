import { isVerdict, type Verdict } from "@/lib/feedback/learned";

/**
 * MW-S06: weekly reflection — deterministic factual summaries plus a bounded
 * carry-forward that the user previews before it shapes next week.
 *
 * Rules encoded here:
 * - Every displayed statement maps to a recorded input (plans created, the
 *   user's own feedback, meals they saved, modes they chose). No causal,
 *   health or personality interpretation, no scores, no streaks.
 * - Carry-forward answers are a closed set; each maps to a canonical prompt
 *   hint (never user free-text), previewable with the exact same mapping.
 * - Pure module: fully unit-testable, timezone handled by the caller passing
 *   `now`.
 */

export interface WeeklyFactInputs {
  plans: { created_at: string; plan_mode?: string | null }[];
  feedback: { verdict: string; created_at: string }[];
  favourites: { created_at: string }[];
}

export interface WeeklyFact {
  text: string;
  /** Which recorded input this statement is derived from. */
  source: "plans" | "feedback" | "favourites" | "modes";
}

const MODE_LABELS: Record<string, string> = {
  minimum: "lightest",
  balanced: "balanced",
  reset: "reset",
  custom: "custom",
};

const FRICTION_LABELS: Partial<Record<Verdict, string>> = {
  too_much: "felt like too much",
  too_little_time: "needed something quicker",
  didnt_fit_food: "didn't fit your food",
  not_for_me: "weren't the right kind of support",
};

function withinDays(iso: string, now: Date, days: number): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= now.getTime() - days * 86400_000 && t <= now.getTime();
}

/** Factual counts/ranges only — reproducible from the user's own rows. */
export function weeklyFacts(inputs: WeeklyFactInputs, now: Date = new Date()): WeeklyFact[] {
  const facts: WeeklyFact[] = [];
  const plans = inputs.plans.filter((p) => withinDays(p.created_at, now, 7));
  if (plans.length > 0) {
    facts.push({
      text: plans.length === 1 ? "You created 1 daily plan." : `You created ${plans.length} daily plans.`,
      source: "plans",
    });
  }
  const modeCounts = new Map<string, number>();
  for (const p of plans) {
    const label = MODE_LABELS[p.plan_mode ?? ""];
    if (label) modeCounts.set(label, (modeCounts.get(label) ?? 0) + 1);
  }
  if (modeCounts.size > 0) {
    const parts = [...modeCounts.entries()].map(([label, n]) => `${label} ×${n}`);
    facts.push({ text: `Modes you chose: ${parts.join(", ")}.`, source: "modes" });
  }
  const feedback = inputs.feedback.filter((f) => withinDays(f.created_at, now, 7));
  const helpful = feedback.filter((f) => f.verdict === "helpful").length;
  if (helpful > 0) {
    facts.push({
      text: helpful === 1 ? "You marked 1 item as helpful." : `You marked ${helpful} items as helpful.`,
      source: "feedback",
    });
  }
  const frictionCounts = new Map<Verdict, number>();
  for (const f of feedback) {
    if (isVerdict(f.verdict) && f.verdict !== "helpful") {
      frictionCounts.set(f.verdict, (frictionCounts.get(f.verdict) ?? 0) + 1);
    }
  }
  for (const [verdict, n] of frictionCounts) {
    const label = FRICTION_LABELS[verdict];
    if (label) {
      facts.push({
        text: `${n === 1 ? "1 day" : `${n} days`} ${label} (your words, from feedback).`,
        source: "feedback",
      });
    }
  }
  const saved = inputs.favourites.filter((f) => withinDays(f.created_at, now, 7)).length;
  if (saved > 0) {
    facts.push({
      text: saved === 1 ? "You saved 1 meal." : `You saved ${saved} meals.`,
      source: "favourites",
    });
  }
  return facts;
}

// --- Bounded carry-forward answers -----------------------------------------

export const KEEP_OPTIONS = [
  "meals",
  "calm_resets",
  "movement",
  "evening_routine",
  "nothing",
] as const;
export const LIGHTER_OPTIONS = [
  "whole_week",
  "mornings",
  "evenings",
  "meals",
  "nothing",
] as const;
export const CONSTRAINT_OPTIONS = [
  "less_time",
  "more_time",
  "away_or_travel",
  "irregular_schedule",
  "same_as_usual",
] as const;

export interface WeeklyReflectionSelections {
  keep: (typeof KEEP_OPTIONS)[number][];
  lighter: (typeof LIGHTER_OPTIONS)[number] | null;
  constraint: (typeof CONSTRAINT_OPTIONS)[number] | null;
}

/** Canonical, user-visible effect of each selection — used for BOTH the
 * preview shown before saving and the generation hint, so nothing is applied
 * that wasn't previewed. */
export const CARRY_EFFECTS: Record<string, string> = {
  "keep:meals": "Keep the meal approach similar to last week.",
  "keep:calm_resets": "Keep the calm resets that were used.",
  "keep:movement": "Keep the movement style similar.",
  "keep:evening_routine": "Keep the evening wind-down approach.",
  "lighter:whole_week": "Make the whole week lighter — fewer, smaller items.",
  "lighter:mornings": "Make mornings lighter.",
  "lighter:evenings": "Make evenings lighter.",
  "lighter:meals": "Make meals simpler and quicker.",
  "constraint:less_time": "Plan around less available time next week.",
  "constraint:more_time": "Next week has a bit more room than usual.",
  "constraint:away_or_travel": "Plan for being away or travelling part of the week.",
  "constraint:irregular_schedule": "Plan around an irregular schedule.",
};

/**
 * MW-V9-05: the single canonical reading of a stored weekly_reflections row
 * into carry-forward selections. Both the weekly prompt builder and the
 * personalization center use this, so the effect shown in "What Mellowa uses"
 * is exactly what a future weekly generation would apply — no second mapping.
 * "nothing" / "same_as_usual" collapse to null (no carry-forward for that axis).
 */
export interface RawReflectionRow {
  keep?: string[] | null;
  lighter?: string | null;
  next_week_constraint?: string | null;
  created_at?: string | null;
}

export function reflectionSelectionsFromRow(
  row: RawReflectionRow | null | undefined
): WeeklyReflectionSelections {
  if (!row) return { keep: [], lighter: null, constraint: null };
  const keep = ((row.keep ?? []) as string[]).filter((k): k is WeeklyReflectionSelections["keep"][number] =>
    (KEEP_OPTIONS as readonly string[]).includes(k)
  );
  const lighter =
    row.lighter && row.lighter !== "nothing" && (LIGHTER_OPTIONS as readonly string[]).includes(row.lighter)
      ? (row.lighter as WeeklyReflectionSelections["lighter"])
      : null;
  const constraint =
    row.next_week_constraint &&
    row.next_week_constraint !== "same_as_usual" &&
    (CONSTRAINT_OPTIONS as readonly string[]).includes(row.next_week_constraint)
      ? (row.next_week_constraint as WeeklyReflectionSelections["constraint"])
      : null;
  return { keep, lighter, constraint };
}

/** A reflection older than 14 days no longer carries forward (matches the
 * weekly generation window), so the center never shows a stale carry-forward. */
export function isReflectionFresh(
  createdAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(t) && t > now.getTime() - 14 * 86400_000;
}

export function carryForwardEffects(sel: WeeklyReflectionSelections): string[] {
  const effects: string[] = [];
  for (const k of sel.keep) {
    const e = CARRY_EFFECTS[`keep:${k}`];
    if (e) effects.push(e);
  }
  if (sel.lighter) {
    const e = CARRY_EFFECTS[`lighter:${sel.lighter}`];
    if (e) effects.push(e);
  }
  if (sel.constraint) {
    const e = CARRY_EFFECTS[`constraint:${sel.constraint}`];
    if (e) effects.push(e);
  }
  return effects;
}

/** Canonical hint block for the next weekly generation, or "" when empty. */
export function reflectionToWeeklyHints(sel: WeeklyReflectionSelections): string {
  const effects = carryForwardEffects(sel);
  if (!effects.length) return "";
  return `WHAT THE USER CHOSE TO CARRY INTO THIS WEEK (their explicit weekly reflection):\n${effects
    .map((e) => `- ${e}`)
    .join("\n")}`;
}
