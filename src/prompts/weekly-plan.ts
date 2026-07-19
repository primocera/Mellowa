import { MELLOWA_VOICE_RULES } from "@/prompts/voice";

export const WEEKLY_PLAN_SYSTEM_PROMPT = `You are a gentle weekly wellbeing planner.
Create a realistic weekly structure for meals, hydration, movement, stress resets, habits and reflection.
Do not create strict diets, calorie rules, medical meal plans or intense routines.
Focus on consistency and reducing decision fatigue.
Include low-energy backup options.
Use recent check-ins to adjust difficulty.

Return structured JSON only with this shape:
{
  "weekly_focus": string,
  "meal_structure": {
    "title": string,
    "days": [{ "day": string, "breakfast": string, "lunch": string, "dinner": string, "snack": string }],
    "notes": string
  },
  "shopping_list": {
    "title": string,
    "items": [{ "item": string, "quantity": string, "category": string }]
  },
  "movement_plan": { "title": string, "items": [{ "title": string, "description": string, "time_hint": string }] },
  "stress_reset_plan": { "title": string, "items": [...] },
  "habit_plan": { "title": string, "focus_habit": string, "minimum_version": string, "tips": [string] },
  "low_energy_backup_plan": { "title": string, "items": [...] },
  "weekly_review_questions": [string]
}
Shopping list categories: produce, protein, pantry, dairy, frozen, other.
Keep everything simple, budget-aware and realistic.
${MELLOWA_VOICE_RULES}`;

/**
 * MW-S05: normalized meal-continuity input. Only allergen-validated favourite
 * metadata (title, meal type, ingredient names) and bounded preference values
 * ever reach the prompt — no notes, no health inference, no preset names.
 */
export interface MealContinuityContext {
  favourites: { title: string; meal_type: string; ingredients: string[] }[];
  repeatLeftovers: boolean;
  varietyLevel: string | null;
  pantryItems: string[];
}

function mealContinuityBlock(m: MealContinuityContext): string {
  const parts: string[] = [];
  if (m.favourites.length) {
    parts.push(`SAVED FAVOURITE MEALS the user wants reused this week (use the exact titles and append " (saved favourite)" when you schedule one):
${JSON.stringify(m.favourites, null, 2)}`);
  }
  if (m.repeatLeftovers) {
    parts.push(
      `The user likes cooking once and eating twice: plan realistic leftovers (e.g. dinner reused for next day's lunch) and append " (leftovers)" to those meals.`
    );
  }
  if (m.varietyLevel) {
    const variety: Record<string, string> = {
      keep_it_similar:
        "Keep meals similar across the week — repetition is welcome, not a flaw.",
      some_variety: "Aim for some variety while reusing favourites and leftovers.",
      lots_of_variety: "Aim for noticeable variety across the week.",
    };
    parts.push(variety[m.varietyLevel] ?? "");
  }
  if (m.pantryItems.length) {
    parts.push(
      `Ingredients already on hand (favour meals that use them; do NOT add them to the shopping list): ${m.pantryItems.join(", ")}`
    );
  }
  if (!parts.length) return "";
  return `\nMEAL CONTINUITY (practical reuse — never a diet or nutrition target):\n${parts.filter(Boolean).join("\n")}\n`;
}

export function buildWeeklyPlanUserPrompt(args: {
  profile: Record<string, unknown>;
  recentCheckins: Record<string, unknown>[];
  habits: string[];
  notes: string;
  weekStart: string;
  mealContinuity?: MealContinuityContext;
}): string {
  return `Week starting: ${args.weekStart}

User wellbeing profile:
${JSON.stringify(args.profile, null, 2)}

Recent check-ins (up to 14 days):
${JSON.stringify(args.recentCheckins, null, 2)}

Active habits: ${args.habits.length ? args.habits.join(", ") : "none yet"}
${args.mealContinuity ? mealContinuityBlock(args.mealContinuity) : ""}${args.notes ? `\nUser notes for this week: """${args.notes}"""` : ""}

Create this week's plan as structured JSON.`;
}
