import type { DailyPlanV2OutputType } from "@/schemas/ai-output-v2";

/**
 * MW-V10-04: repetition detection across consecutive days.
 *
 * The failure this catches: every individual plan passes every gate, and the
 * week is the same day four times. Nothing in the existing suite could see it,
 * because every check operated on one plan in isolation. Repetition is the
 * quiet reason a user stops opening the app — not a safety problem, an interest
 * problem.
 *
 * The hard part is that *some* repetition is the product working:
 *  - a meal the user marked as a favourite is supposed to come back;
 *  - a leftover is supposed to appear the day after the meal it came from;
 *  - a habit is by definition the same small thing every day.
 *
 * So intentional reuse is declared by the caller and excluded, rather than
 * inferred. What is left — the model quietly running out of ideas — is what
 * gets reported.
 *
 * Pure module: same plans in, same findings out, no dates and no randomness.
 */

export interface RepetitionDay {
  /** Stable label for the day, e.g. "day-1". Used only in findings. */
  id: string;
  plan: DailyPlanV2OutputType;
  /**
   * Meal titles on this day that the user explicitly asked to see again
   * (saved favourites) or that reuse yesterday's cooking (leftovers). These are
   * intended reuse and are never counted as repetition.
   */
  intentionalMealTitles?: readonly string[];
}

export interface RepetitionFinding {
  code:
    | "meal_title_repeated"
    | "meal_ingredients_repeated"
    | "movement_repeated"
    | "calm_reset_repeated"
    | "focus_repeated";
  detail: string;
  /** Days involved, for a reproducible report. */
  dayIds: string[];
}

export interface RepetitionOptions {
  /**
   * How many times the same thing may appear across the window before it is a
   * finding. 2 means "twice is fine, three times is not" — a plan repeating one
   * meal across a week is normal life, four identical days is not.
   */
  maxRepeats?: number;
  /** Ingredient-overlap ratio above which two meals count as the same meal. */
  ingredientOverlapThreshold?: number;
}

const DEFAULTS: Required<RepetitionOptions> = {
  maxRepeats: 2,
  ingredientOverlapThreshold: 0.8,
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Ingredient names only, normalised, with optional items excluded. */
function coreIngredients(names: readonly { name: string; optional: boolean }[]): Set<string> {
  return new Set(names.filter((i) => !i.optional).map((i) => norm(i.name)));
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  // Ratio against the smaller set: a three-ingredient meal fully contained in a
  // four-ingredient one is the same meal with a garnish.
  return shared / Math.min(a.size, b.size);
}

/**
 * Count occurrences of each value and report the ones over the limit. Kept
 * generic so every dimension reports in the same shape and order.
 */
function overRepeated(
  entries: readonly { dayId: string; value: string }[],
  maxRepeats: number
): Map<string, string[]> {
  const byValue = new Map<string, string[]>();
  for (const e of entries) {
    if (!e.value) continue;
    const list = byValue.get(e.value) ?? [];
    list.push(e.dayId);
    byValue.set(e.value, list);
  }
  const over = new Map<string, string[]>();
  for (const [value, dayIds] of byValue) {
    if (dayIds.length > maxRepeats) over.set(value, dayIds);
  }
  return over;
}

export function repetitionAcross(
  days: readonly RepetitionDay[],
  options: RepetitionOptions = {}
): RepetitionFinding[] {
  const { maxRepeats, ingredientOverlapThreshold } = { ...DEFAULTS, ...options };
  const findings: RepetitionFinding[] = [];
  if (days.length < 2) return findings;

  // 1. Identical meal titles, excluding declared intentional reuse.
  const mealTitles: { dayId: string; value: string }[] = [];
  for (const day of days) {
    const intentional = new Set((day.intentionalMealTitles ?? []).map(norm));
    for (const meal of day.plan.meal_cards) {
      const title = norm(meal.title);
      if (intentional.has(title)) continue;
      mealTitles.push({ dayId: day.id, value: title });
    }
  }
  for (const [title, dayIds] of overRepeated(mealTitles, maxRepeats)) {
    findings.push({
      code: "meal_title_repeated",
      detail: `meal "${title}" appears ${dayIds.length} times and was not marked as a favourite or leftover`,
      dayIds,
    });
  }

  // 2. Different titles, same meal. Catches "Veggie bowl" / "Vegetable bowl"
  //    built from an identical ingredient list — renaming is not variety.
  const meals: { dayId: string; title: string; core: Set<string>; intentional: boolean }[] = [];
  for (const day of days) {
    const intentional = new Set((day.intentionalMealTitles ?? []).map(norm));
    for (const meal of day.plan.meal_cards) {
      meals.push({
        dayId: day.id,
        title: norm(meal.title),
        core: coreIngredients(meal.ingredients),
        intentional: intentional.has(norm(meal.title)),
      });
    }
  }
  for (let i = 0; i < meals.length; i++) {
    for (let j = i + 1; j < meals.length; j++) {
      const a = meals[i];
      const b = meals[j];
      if (a.dayId === b.dayId) continue;
      if (a.intentional || b.intentional) continue;
      // Identical titles are already reported above; this is the disguised case.
      if (a.title === b.title) continue;
      if (overlapRatio(a.core, b.core) >= ingredientOverlapThreshold) {
        findings.push({
          code: "meal_ingredients_repeated",
          detail: `"${a.title}" and "${b.title}" share the same core ingredients — a rename, not a different meal`,
          dayIds: [a.dayId, b.dayId],
        });
      }
    }
  }

  // 3. The optional blocks. A habit is deliberately excluded: repeating one
  //    small habit daily is the feature, not a failure.
  const dimensions: {
    code: RepetitionFinding["code"];
    label: string;
    valueOf: (p: DailyPlanV2OutputType) => string;
  }[] = [
    {
      code: "movement_repeated",
      label: "movement",
      valueOf: (p) => norm(p.movement_moment?.title ?? ""),
    },
    {
      code: "calm_reset_repeated",
      label: "calm reset",
      valueOf: (p) =>
        norm(
          p.breathing_exercise?.name ??
            p.meditation_or_reflection?.name ??
            p.relaxation_technique?.name ??
            ""
        ),
    },
    {
      code: "focus_repeated",
      label: "focus task",
      valueOf: (p) => norm(p.focus_block?.main_task ?? ""),
    },
  ];

  for (const dim of dimensions) {
    const entries = days.map((d) => ({ dayId: d.id, value: dim.valueOf(d.plan) }));
    for (const [value, dayIds] of overRepeated(entries, maxRepeats)) {
      findings.push({
        code: dim.code,
        detail: `${dim.label} "${value}" is identical on ${dayIds.length} days`,
        dayIds,
      });
    }
  }

  // Stable order so a report diff is meaningful between runs.
  return findings.sort(
    (a, b) => a.code.localeCompare(b.code) || a.detail.localeCompare(b.detail)
  );
}

/**
 * A one-line variety verdict for the human rubric. Deliberately not a score:
 * the rubric asks a person to judge whether the week felt repetitive, and this
 * only tells them where to look.
 */
export function repetitionSummary(findings: readonly RepetitionFinding[]): string {
  if (findings.length === 0) return "No repetition beyond declared favourites and leftovers.";
  const codes = [...new Set(findings.map((f) => f.code))];
  return `${findings.length} repetition finding(s) across ${codes.length} dimension(s): ${codes.join(", ")}.`;
}
