import "server-only";
import { bannedLanguageReasons, type QualityResult } from "@/lib/ai/quality-checks";
import { findAllergenCategoriesInText } from "@/lib/safety/allergens";
import type {
  WeeklyPlanOutputType,
  MealRhythmOutputType,
  HabitPlanOutputType,
  JournalReflectionOutputType,
} from "@/schemas/ai-output";
import type { LowEnergyDayOutputType } from "@/schemas/low-energy-day";
import type { MealCardType } from "@/schemas/ai-output-v2";

/**
 * Route-specific output quality gates (Launch v6, Prompt 13).
 *
 * Every AI surface validates its output BEFORE saving or showing it:
 * banned medical/therapy/diet/shame language (shared BANNED_PATTERNS),
 * deterministic allergen scans on every meal-bearing output, and per-route
 * rules. Routes regenerate at most once with a corrective instruction, then
 * fail closed. Failure reasons go to the AI ledger as quality_failed —
 * never the content itself.
 */

function result(reasons: string[]): QualityResult {
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

// ---------- Weekly plan ----------

export function checkWeeklyPlanOutput(
  plan: WeeklyPlanOutputType,
  allergies: string[]
): QualityResult {
  const reasons = bannedLanguageReasons(plan);
  // Deterministic allergen scan across all meal-bearing parts.
  const mealText = JSON.stringify([plan.meal_structure, plan.shopping_list]);
  for (const cat of findAllergenCategoriesInText(mealText, allergies)) {
    reasons.push(`allergen:${cat}`);
  }
  if (!plan.habit_plan.focus_habit.trim()) reasons.push("empty focus habit");
  return result(reasons);
}

// ---------- Meal rhythm ----------

export function checkMealRhythmOutput(
  ideas: MealRhythmOutputType,
  allergies: string[]
): QualityResult {
  const reasons = bannedLanguageReasons(ideas);
  for (const cat of findAllergenCategoriesInText(JSON.stringify(ideas), allergies)) {
    reasons.push(`allergen:${cat}`);
  }
  return result(reasons);
}

// ---------- Habit plan ----------

export function checkHabitPlanOutput(plan: HabitPlanOutputType): QualityResult {
  const reasons = bannedLanguageReasons(plan);
  for (const h of plan.habits) {
    if (!h.minimum_version.trim()) reasons.push(`habit "${h.name}" missing minimum version`);
  }
  return result(reasons);
}

// ---------- Low-energy day ----------

export function checkLowEnergyDayOutput(
  plan: LowEnergyDayOutputType,
  allergies: string[]
): QualityResult {
  const reasons = bannedLanguageReasons(plan);
  for (const cat of findAllergenCategoriesInText(JSON.stringify(plan.easy_meals), allergies)) {
    reasons.push(`allergen:${cat}`);
  }
  if (!plan.one_tiny_habit.minimum_version.trim()) reasons.push("missing habit minimum version");
  // A low-energy day must stay minimal — the schema caps sizes; also require
  // that no minimum-day item promises productivity pressure.
  return result(reasons);
}

// ---------- Journal reflection ----------

// Beyond the shared bans: no diagnosis, clinical interpretation, crisis
// counselling, or certainty about the user's emotional state.
const JOURNAL_BANNED: { pattern: RegExp; reason: string }[] = [
  { pattern: /\byou (are|sound|seem|must be) (clearly |definitely |probably )?(depressed|anxious|bipolar|traumatized|burn(ed|t)[- ]out|mentally)/i, reason: "certainty about emotional state" },
  { pattern: /\b(you (have|show signs of)|this (sounds|looks) like) (depression|anxiety|adhd|ocd|ptsd|a disorder|burnout)/i, reason: "clinical interpretation" },
  { pattern: /\b(hotline|helpline|crisis line|emergency room|call 911|call 112)\b/i, reason: "crisis counselling belongs to the safety flow" },
  { pattern: /\b(you should (see|talk to) a (therapist|doctor|psychiatrist))\b/i, reason: "clinical referral language" },
  { pattern: /\b(symptom|clinical|medicat)/i, reason: "clinical language" },
];

export function checkJournalReflectionOutput(
  r: JournalReflectionOutputType
): QualityResult {
  const reasons = bannedLanguageReasons(r);
  const text = `${r.reflection} ${r.gentle_question} ${r.one_small_action}`;
  for (const { pattern, reason } of JOURNAL_BANNED) {
    if (pattern.test(text)) reasons.push(reason);
  }
  return result(reasons);
}

// ---------- Regenerated meal card ----------

export function checkRegeneratedMealOutput(meal: MealCardType): QualityResult {
  const reasons = bannedLanguageReasons(meal);
  if (!meal.safety_note.trim()) reasons.push("missing macro safety note");
  if (meal.preparation_steps.length < 2) reasons.push("too few preparation steps");
  return result(reasons);
}

/** Safe corrective instruction for the single allowed regeneration. */
export function correctiveInstruction(reasons: string[]): string {
  return `The previous output failed Mellowa's quality review (${reasons.join(
    ", "
  )}). Regenerate it following every rule strictly: no medical, therapy, diagnostic or diet-culture language; no calorie targets or weight-loss framing; warm, calm, non-judgmental tone; keep all required safety notes; completely avoid all listed allergens.`;
}
