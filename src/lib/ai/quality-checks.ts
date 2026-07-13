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
const BANNED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b\d+\s*(k?cal|calorie)/i, reason: "calorie framing" },
  { pattern: /\b(lose|losing)\s+\d+\s*(kg|lbs|pounds|kilo)/i, reason: "weight-loss promise" },
  { pattern: /\b(burn\s+fat|fat[- ]burning|cutting\s+weight)\b/i, reason: "diet-culture language" },
  { pattern: /\b(fasting|skip\s+(all\s+)?meals?|don'?t\s+eat)\b/i, reason: "restrictive eating" },
  { pattern: /\b(diagnos|prescri|treatment\s+plan|medication)\b/i, reason: "medical language" },
  { pattern: /\b(trauma|therapy\s+session|disorder)\b/i, reason: "therapy language" },
  { pattern: /\b(lazy|no\s+excuses|push\s+through\s+the\s+pain|shame)\b/i, reason: "shame language" },
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
 * Same safety intent, adapted to the richer shape.
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

  // Allergen safety: any listed allergy must not appear as an ingredient.
  // (Allergy checking against the profile happens in the route; here we only
  //  ensure meals actually carry a macro safety note.)
  for (const meal of plan.meal_cards) {
    if (!meal.safety_note.trim()) {
      reasons.push(`meal "${meal.title}" missing macro safety note`);
    }
    if (meal.preparation_steps.length < 2) {
      reasons.push(`meal "${meal.title}" has too few steps`);
    }
  }

  // Movement must carry a caution note.
  if (!plan.movement_moment.caution_note.trim()) {
    reasons.push("movement missing caution note");
  }

  // Breathing must carry a gentle note.
  if (!plan.breathing_exercise.gentle_note.trim()) {
    reasons.push("breathing missing gentle note");
  }

  // Habit must include a minimum version.
  if (!plan.one_small_habit.minimum_version.trim()) {
    reasons.push("missing habit minimum version");
  }

  if (!plan.encouragement.trim()) {
    reasons.push("missing encouragement");
  }

  // Low-energy / high-stress days should not pile on long routines.
  const shouldBeLight = context.energy_level <= 2 || context.stress_level >= 4;
  if (shouldBeLight) {
    const longestSection = Math.max(
      plan.movement_moment.steps.length,
      plan.evening_wind_down.steps.length,
      plan.breathing_exercise.steps.length
    );
    if (longestSection > 8) {
      reasons.push("routines too long for a low-energy / high-stress day");
    }
  }

  return reasons.length ? { ok: false, reasons } : { ok: true };
}
