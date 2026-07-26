import type { DailyPlanV2OutputType, MealCardType } from "@/schemas/ai-output-v2";

/**
 * MW-V10-04: deterministic *fit* validators.
 *
 * The existing quality gate proves a plan is safe, on-tone and not overfull in
 * block count. It cannot tell whether the plan is actually doable: a plan with
 * three blocks can still ask a person with fifteen minutes to cook for forty,
 * and a plan that passes every ban list can still be generic advice
 * ("eat healthy, drink water, get some rest") that no one needed an AI for.
 *
 * Everything here is a pure, reproducible transform of a candidate plan. None
 * of it replaces or softens a safety gate — allergens and the safety classifier
 * remain the hard gates, and a fit finding is never allowed to excuse a safety
 * finding.
 */

export interface FitViolation {
  code:
    | "meal_over_time_budget"
    | "workload_over_budget"
    | "invented_personal_fact"
    | "generic_filler"
    | "missing_minimum_version";
  detail: string;
}

// --- Time and cooking fit -----------------------------------------------------

/**
 * Minutes a stored `cooking_time` preference allows for one meal. These mirror
 * the onboarding options; an unrecognised value returns null, which means
 * "no stated budget" and never a guessed ceiling.
 */
export function cookingBudgetMinutes(cookingTime: string | null | undefined): number | null {
  switch ((cookingTime ?? "").trim()) {
    case "no_cooking":
      return 5;
    case "under_15_min":
      return 15;
    case "under_30_min":
      return 30;
    case "20-30 min":
      return 30;
    case "under_60_min":
      return 60;
    case "any":
      return null;
    default:
      return null;
  }
}

/**
 * A meal breaks the time budget when its own total exceeds the ceiling. A
 * `low_energy_swap` does NOT excuse it: the swap is an alternative the user has
 * to notice and choose, so the primary suggestion must already fit the time
 * they said they have. Small overruns are not tolerated silently — the point of
 * asking for a cooking time is that it is respected.
 */
export function mealTimeFitViolations(
  meals: readonly MealCardType[],
  cookingTime: string | null | undefined
): FitViolation[] {
  const budget = cookingBudgetMinutes(cookingTime);
  if (budget === null) return [];
  const out: FitViolation[] = [];
  for (const meal of meals) {
    if (meal.total_time_minutes > budget) {
      out.push({
        code: "meal_over_time_budget",
        detail: `"${meal.title}" needs ${meal.total_time_minutes} min but the stated budget is ${budget} min`,
      });
    }
    // A no-cooking day means no cooking, not "quick cooking".
    if (budget === 5 && meal.cook_time_minutes > 0) {
      out.push({
        code: "meal_over_time_budget",
        detail: `"${meal.title}" requires ${meal.cook_time_minutes} min of cooking on a no-cooking day`,
      });
    }
  }
  return out;
}

// --- Bounded workload --------------------------------------------------------

/**
 * Total minutes the plan asks of the user, counting only what carries an
 * explicit duration. Meals count their total time; a block with no stated
 * duration contributes nothing rather than an invented estimate.
 */
export function workloadMinutes(plan: DailyPlanV2OutputType): number {
  let total = 0;
  for (const meal of plan.meal_cards) total += meal.total_time_minutes;
  total += plan.movement_moment?.duration_minutes ?? 0;
  total += plan.breathing_exercise?.duration_minutes ?? 0;
  total += plan.meditation_or_reflection?.duration_minutes ?? 0;
  total += plan.relaxation_technique?.duration_minutes ?? 0;
  return total;
}

/**
 * Ceilings per mode, in minutes of *asked-for* time. Deliberately generous —
 * this catches a plan that has quietly become a second job, not one that is
 * merely fuller than average. A "minimum" day that asks for two hours is not a
 * minimum day whatever its block count says.
 */
export const WORKLOAD_BUDGET_MINUTES: Record<string, number> = {
  minimum: 45,
  reset: 90,
  balanced: 120,
  custom: 120,
};

export function workloadViolations(plan: DailyPlanV2OutputType): FitViolation[] {
  const budget = WORKLOAD_BUDGET_MINUTES[plan.plan_mode];
  if (budget === undefined) return [];
  const asked = workloadMinutes(plan);
  if (asked <= budget) return [];
  return [
    {
      code: "workload_over_budget",
      detail: `a ${plan.plan_mode} day asks for ${asked} min of the user's time (budget ${budget} min)`,
    },
  ];
}

// --- Invented personal facts -------------------------------------------------

/**
 * Things a plan may only mention if the user actually told us about them.
 * Each entry is a possessive claim about the user's life: asserting any of them
 * unprompted is the model inventing a fact about a real person, which reads as
 * either uncanny or plainly wrong.
 *
 * Bounded by design. This is not a general hallucination detector — it is a
 * closed list of the specific inventions that would matter most here.
 */
const PERSONAL_FACT_PATTERNS: { pattern: RegExp; fact: string }[] = [
  { pattern: /\byour (partner|husband|wife|spouse|boyfriend|girlfriend)\b/i, fact: "a partner" },
  { pattern: /\byour (kids|children|child|son|daughter|baby)\b/i, fact: "children" },
  { pattern: /\byour (dog|cat|pet)\b/i, fact: "a pet" },
  { pattern: /\byour (gym|yoga class|trainer|studio)\b/i, fact: "a gym or class" },
  { pattern: /\byour (doctor|therapist|dietitian|nutritionist)\b/i, fact: "a clinician" },
  { pattern: /\byour (medication|prescription|supplements?)\b/i, fact: "medication" },
  { pattern: /\byour (commute|office|colleagues|team meeting)\b/i, fact: "a workplace" },
  { pattern: /\byour (garden|balcony|car|bike)\b/i, fact: "a specific possession" },
  { pattern: /\bas you mentioned\b/i, fact: "something the user said" },
  // "same as yesterday", "like you did last week" — a claim about a day we
  // never showed them, which is the most plausible-sounding invention of all.
  {
    pattern: /\b(like|same as|as) (you did |you had )?(yesterday|last week)\b/i,
    fact: "a past day",
  },
];

/**
 * Flag possessive claims about the user's life that the input never supplied.
 * `knownFacts` is the set of terms present in the user's own profile and
 * check-in text: if the user mentioned their commute, the plan may too.
 */
export function inventedPersonalFacts(
  plan: DailyPlanV2OutputType,
  knownFacts: readonly string[] = []
): FitViolation[] {
  const text = JSON.stringify(plan);
  const known = knownFacts.map((k) => k.toLowerCase());
  const out: FitViolation[] = [];
  for (const { pattern, fact } of PERSONAL_FACT_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const claimed = match[0].toLowerCase();
    // The user brought it up first → the plan may reference it.
    if (known.some((k) => claimed.includes(k) || k.includes(claimed.replace(/^your /, "")))) {
      continue;
    }
    out.push({
      code: "invented_personal_fact",
      detail: `plan asserts ${fact} ("${match[0]}") which the input never mentioned`,
    });
  }
  return out;
}

// --- Genericity --------------------------------------------------------------

/**
 * Filler that is technically safe, technically on-tone, and worth nothing: the
 * advice a user could have written themselves before opening the app. A plan
 * made of these is the failure mode that loses the second day of use, and no
 * existing gate catches it because none of it is unsafe.
 */
const GENERIC_PHRASES: readonly string[] = [
  "eat healthy",
  "eat well",
  "stay hydrated",
  "drink water",
  "get some rest",
  "get enough sleep",
  "take a break",
  "listen to your body",
  "practice self-care",
  "be kind to yourself",
  "take it easy",
  "do what feels right",
  "move your body",
  "have a balanced meal",
  "eat something",
  "relax",
];

/**
 * A generic phrase is only a violation where the plan is supposed to be
 * *specific*: a meal title, a movement title, a habit, or the plan's main
 * focus. The same words inside an encouragement line are fine — a calm closing
 * sentence is allowed to be ordinary.
 */
export function genericityViolations(plan: DailyPlanV2OutputType): FitViolation[] {
  const specificSlots: { label: string; value: string }[] = [
    { label: "main focus", value: plan.plan_summary.main_focus },
    ...plan.meal_cards.map((m, i) => ({ label: `meal ${i + 1} title`, value: m.title })),
    ...(plan.movement_moment
      ? [{ label: "movement title", value: plan.movement_moment.title }]
      : []),
    ...(plan.one_small_habit
      ? [{ label: "habit", value: plan.one_small_habit.habit }]
      : []),
    ...(plan.focus_block
      ? [{ label: "focus task", value: plan.focus_block.main_task }]
      : []),
  ];

  const out: FitViolation[] = [];
  for (const slot of specificSlots) {
    const value = slot.value.trim().toLowerCase();
    for (const phrase of GENERIC_PHRASES) {
      // Whole-slot match only: "Eat healthy" as a meal title is filler;
      // "Eat healthy fats with breakfast" is a real instruction.
      if (value === phrase || value === `${phrase}.`) {
        out.push({
          code: "generic_filler",
          detail: `${slot.label} is generic filler ("${slot.value.trim()}")`,
        });
      }
    }
  }
  return out;
}

// --- Doability: every asked-for thing has a smaller version -------------------

/**
 * On a low-capacity day the plan must offer a way down, not just a way out.
 * Every block that asks for effort needs its smaller version, so "I can't do
 * that today" has an answer other than skipping.
 */
export function minimumVersionViolations(
  plan: DailyPlanV2OutputType,
  context: { energy_level: number }
): FitViolation[] {
  if (context.energy_level > 2) return [];
  const out: FitViolation[] = [];
  for (const meal of plan.meal_cards) {
    if (!meal.low_energy_swap.trim()) {
      out.push({
        code: "missing_minimum_version",
        detail: `meal "${meal.title}" has no low-energy swap on a low-energy day`,
      });
    }
  }
  if (plan.movement_moment && !plan.movement_moment.low_energy_version.trim()) {
    out.push({
      code: "missing_minimum_version",
      detail: "movement has no low-energy version on a low-energy day",
    });
  }
  if (plan.evening_wind_down && !plan.evening_wind_down.simple_version.trim()) {
    out.push({
      code: "missing_minimum_version",
      detail: "evening wind-down has no simple version on a low-energy day",
    });
  }
  return out;
}

/** All fit checks for one candidate plan, in a stable order. */
export function allFitViolations(
  plan: DailyPlanV2OutputType,
  context: {
    cookingTime?: string | null;
    energy_level: number;
    knownFacts?: readonly string[];
  }
): FitViolation[] {
  return [
    ...mealTimeFitViolations(plan.meal_cards, context.cookingTime),
    ...workloadViolations(plan),
    ...inventedPersonalFacts(plan, context.knownFacts ?? []),
    ...genericityViolations(plan),
    ...minimumVersionViolations(plan, context),
  ];
}
