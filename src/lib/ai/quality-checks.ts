import "server-only";
import type { DailyPlanOutputType } from "@/schemas/ai-output";
import type { DailyPlanV2OutputType } from "@/schemas/ai-output-v2";

/**
 * Post-generation quality gate for daily plans (Prompt 31).
 * Catches plans that are too full, diet-like, medical or shaming
 * BEFORE they are saved and shown to the user.
 *
 * Documented expectations:
 * - low energy   → few items per section, gentle wording
 * - high stress  → short plan, one stress reset
 * - busy day     → minimum viable day, no full productivity schedule
 * - normal day   → still calm; max ~4 items per section
 */

export type QualityResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

// Language that must never appear in a wellness plan
export const BANNED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b\d+\s*(k?cal|calorie)/i, reason: "calorie framing" },
  { pattern: /\b(lose|losing)\s+\d+\s*(kg|lbs|pounds|kilo)/i, reason: "weight-loss promise" },
  { pattern: /\b(burn\s+fat|fat[- ]burning|cutting\s+weight)\b/i, reason: "diet-culture language" },
  { pattern: /\b(fasting|skip\s+(all\s+)?meals?|don'?t\s+eat)\b/i, reason: "restrictive eating" },
  { pattern: /\b(diagnos|prescri|treatment\s+plan|medication)\b/i, reason: "medical language" },
  { pattern: /\b(trauma|therapy\s+session|disorder)\b/i, reason: "therapy language" },
  { pattern: /\b(lazy|no\s+excuses|push\s+through\s+the\s+pain|shame)\b/i, reason: "shame language" },
  // Voice rules (CE-18): no cheerleading, invented emotion, pseudo-clinical
  // claims or moral food language in generated plans.
  { pattern: /you'?ve\s+got\s+this/i, reason: "banned cheerleading phrase" },
  { pattern: /you\s+seem\s+(anxious|stressed|depressed|sad|overwhelmed)/i, reason: "invented emotion" },
  { pattern: /your\s+body\s+needs/i, reason: "invented bodily claim" },
  { pattern: /(nervous\s+system|cortisol|hormon(e|al)|inflammation|metabolism|detox)/i, reason: "pseudo-clinical claim" },
  { pattern: /(clean\s+eating|guilt[- ]free|cheat\s+(day|meal)|earned\s+(your|this)\s+(food|meal|treat))/i, reason: "moral food language" },
];

const MAX_ITEMS_PER_SECTION = 6;
const MAX_TOTAL_ITEMS = 28;

function collectText(plan: DailyPlanOutputType): string {
  return JSON.stringify(plan).toLowerCase();
}

function sectionItemCounts(plan: DailyPlanOutputType): number[] {
  return [
    plan.morning_routine,
    plan.meal_rhythm,
    plan.hydration_plan,
    plan.movement_plan,
    plan.stress_reset,
    plan.focus_plan,
    plan.evening_routine,
  ].map((s) => s.items.length);
}

export function checkDailyPlanQuality(
  plan: DailyPlanOutputType,
  context: { energy_level: number; stress_level: number }
): QualityResult {
  const reasons: string[] = [];

  // 1. Not too full — overall and per section
  const counts = sectionItemCounts(plan);
  const total = counts.reduce((a, b) => a + b, 0);
  if (counts.some((c) => c > MAX_ITEMS_PER_SECTION)) {
    reasons.push("a section has too many items");
  }
  if (total > MAX_TOTAL_ITEMS) {
    reasons.push(`plan is too full (${total} items)`);
  }

  // Low energy or high stress → plan must be light
  const shouldBeLight = context.energy_level <= 2 || context.stress_level >= 4;
  if (shouldBeLight && total > 18) {
    reasons.push("plan is too heavy for a low-energy / high-stress day");
  }

  // 2. Habit focus must include the habit and ideally a minimum version
  if (!plan.habit_focus.habit.trim()) {
    reasons.push("missing habit focus");
  }

  // 3-8. Banned language scan across the whole plan
  const text = collectText(plan);
  for (const { pattern, reason } of BANNED_PATTERNS) {
    if (pattern.test(text)) reasons.push(reason);
  }

  // 9. Encouragement present and not empty
  if (!plan.encouragement.trim()) {
    reasons.push("missing encouragement");
  }

  return reasons.length ? { ok: false, reasons } : { ok: true };
}

/**
 * Quality gate for the v2 daily plan (meal cards, movement, calm reset).
 * Mode-aware (Prompt 2): wellbeing blocks are optional; density limits depend
 * on the plan mode so "gentle" never becomes a checklist.
 */
export function checkDailyPlanV2Quality(
  plan: DailyPlanV2OutputType,
  context: { energy_level: number; stress_level: number }
): QualityResult {
  const reasons: string[] = [];

  // Banned language across the whole plan
  const text = JSON.stringify(plan).toLowerCase();
  for (const { pattern, reason } of BANNED_PATTERNS) {
    if (pattern.test(text)) reasons.push(reason);
  }

  // Meals must carry the macro safety note and usable steps.
  for (const meal of plan.meal_cards) {
    if (!meal.safety_note.trim()) {
      reasons.push(`meal "${meal.title}" missing macro safety note`);
    }
    if (meal.preparation_steps.length < 2) {
      reasons.push(`meal "${meal.title}" has too few steps`);
    }
  }

  // Present blocks must carry their safety notes.
  if (plan.movement_moment && !plan.movement_moment.caution_note.trim()) {
    reasons.push("movement missing caution note");
  }
  if (plan.breathing_exercise && !plan.breathing_exercise.gentle_note.trim()) {
    reasons.push("breathing missing gentle note");
  }
  if (plan.one_small_habit && !plan.one_small_habit.minimum_version.trim()) {
    reasons.push("missing habit minimum version");
  }

  if (!plan.encouragement.trim()) {
    reasons.push("missing encouragement");
  }

  // ----- Mode density rules -----
  const calmCount = [
    plan.breathing_exercise,
    plan.meditation_or_reflection,
    plan.relaxation_technique,
  ].filter((b) => b != null).length;
  const optionalBlocks = [
    plan.movement_moment,
    plan.breathing_exercise,
    plan.meditation_or_reflection,
    plan.relaxation_technique,
    plan.focus_block,
    plan.evening_wind_down,
    plan.one_small_habit,
  ].filter((b) => b != null).length;
  const totalBlocks = plan.meal_cards.length + optionalBlocks;

  switch (plan.plan_mode) {
    case "minimum":
      if (totalBlocks > 4) {
        reasons.push(`minimum day too full (${totalBlocks} blocks, max 4)`);
      }
      if (plan.focus_block) reasons.push("minimum day must not include a focus block");
      if (calmCount > 1) reasons.push("minimum day has more than one calm practice");
      break;
    case "reset":
      if (plan.focus_block) reasons.push("reset day must not include a focus block");
      if (totalBlocks > 7) reasons.push(`reset day too full (${totalBlocks} blocks)`);
      if (calmCount > 2) reasons.push("reset day has too many calm practices");
      break;
    case "balanced":
      if (calmCount > 1) {
        reasons.push("balanced day must include exactly one calm practice");
      }
      if (totalBlocks > 9) reasons.push(`balanced day too full (${totalBlocks} blocks)`);
      break;
    case "custom":
      if (totalBlocks > 9) reasons.push(`custom day too full (${totalBlocks} blocks)`);
      break;
  }

  // Low-energy / high-stress days should not pile on long routines.
  const shouldBeLight = context.energy_level <= 2 || context.stress_level >= 4;
  if (shouldBeLight) {
    const longestSection = Math.max(
      plan.movement_moment?.steps.length ?? 0,
      plan.evening_wind_down?.steps.length ?? 0,
      plan.breathing_exercise?.steps.length ?? 0
    );
    if (longestSection > 8) {
      reasons.push("routines too long for a low-energy / high-stress day");
    }
  }

  return reasons.length ? { ok: false, reasons } : { ok: true };
}

/** Scans any serializable value for banned language; returns matched reasons. */
export function bannedLanguageReasons(value: unknown): string[] {
  const text = JSON.stringify(value).toLowerCase();
  const reasons: string[] = [];
  for (const { pattern, reason } of BANNED_PATTERNS) {
    if (pattern.test(text)) reasons.push(reason);
  }
  return reasons;
}
