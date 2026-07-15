import "server-only";
import type { DailyPlanV2OutputType } from "@/schemas/ai-output-v2";

/**
 * Curated fallback daily plan (Prompt 16).
 *
 * When the AI provider is unavailable (outage/timeout) we would rather hand the
 * user a gentle, pre-written Minimum Day than an error screen. This plan is
 * deliberately simple, uses common whole foods, and carries the same safety
 * framing as generated plans.
 *
 * IMPORTANT: this is a STATIC plan and cannot honour a user's allergy list, so
 * callers MUST only serve it to users with no listed allergies. It intentionally
 * contains no top-allergen ingredients (nuts, dairy, egg, gluten, soy, fish,
 * shellfish, sesame), but that is a courtesy, not a guarantee.
 */
export function buildFallbackDailyPlan(): DailyPlanV2OutputType {
  return {
    plan_summary: {
      main_focus: "A calm, simple day",
      energy_match: "Gentle and low-effort",
      short_note:
        "We couldn't build a custom plan right now, so here's a simple Minimum Day to fall back on.",
    },
    plan_intensity: "low_energy",
    plan_mode: "minimum",
    meal_cards: [
      {
        meal_type: "breakfast",
        title: "Oats with banana",
        short_description: "A warm, steadying start that needs almost no effort.",
        prep_time_minutes: 2,
        cook_time_minutes: 3,
        total_time_minutes: 5,
        difficulty: "easy",
        budget_level: "low",
        servings: 1,
        ingredients: [
          { name: "Rolled oats", amount: "1/2 cup", optional: false },
          { name: "Water", amount: "1 cup", optional: false },
          { name: "Banana", amount: "1, sliced", optional: false },
          { name: "Cinnamon", amount: "a pinch", optional: true },
        ],
        preparation_steps: [
          "Simmer the oats in water for 3 minutes, stirring now and then.",
          "Top with sliced banana and a pinch of cinnamon.",
        ],
        approximate_macros: {
          calories: 300,
          protein_g: 7,
          carbs_g: 60,
          fat_g: 4,
          fiber_g: 7,
        },
        why_it_fits_today: "Low effort, gentle on the stomach, steady energy.",
        low_energy_swap: "Use instant oats and just add hot water.",
        vegetarian_swap: "",
        dairy_free_swap: "",
        gluten_free_swap: "Use certified gluten-free oats.",
        leftovers_tip: "",
        grocery_items: ["Rolled oats", "Bananas"],
        safety_note: "Macros are approximate and not medical nutrition advice.",
      },
      {
        meal_type: "dinner",
        title: "Simple rice & vegetable bowl",
        short_description: "One pot, few ingredients, easy to adjust.",
        prep_time_minutes: 5,
        cook_time_minutes: 15,
        total_time_minutes: 20,
        difficulty: "easy",
        budget_level: "low",
        servings: 1,
        ingredients: [
          { name: "Rice", amount: "3/4 cup, cooked", optional: false },
          { name: "Mixed frozen vegetables", amount: "1 cup", optional: false },
          { name: "Olive oil", amount: "1 tbsp", optional: false },
          { name: "Salt and pepper", amount: "to taste", optional: true },
        ],
        preparation_steps: [
          "Cook the rice, or use pre-cooked rice to save time.",
          "Warm the vegetables in a pan with the olive oil for 5 minutes.",
          "Combine, season lightly, and enjoy in a bowl.",
        ],
        approximate_macros: {
          calories: 420,
          protein_g: 9,
          carbs_g: 70,
          fat_g: 12,
          fiber_g: 8,
        },
        why_it_fits_today: "Filling, forgiving, and needs very little attention.",
        low_energy_swap: "Use microwaveable rice and steam-in-bag vegetables.",
        vegetarian_swap: "",
        dairy_free_swap: "",
        gluten_free_swap: "",
        leftovers_tip: "Doubles easily — keep half for tomorrow's lunch.",
        grocery_items: ["Rice", "Frozen mixed vegetables", "Olive oil"],
        safety_note: "Macros are approximate and not medical nutrition advice.",
      },
    ],
    hydration_plan: {
      goal: "Sip water steadily through the day",
      timing: [
        "A glass of water when you wake up",
        "A glass with each meal",
        "One more in the afternoon",
      ],
    },
    movement_moment: null,
    breathing_exercise: null,
    meditation_or_reflection: null,
    relaxation_technique: null,
    focus_block: null,
    evening_wind_down: null,
    one_small_habit: {
      habit: "One glass of water with breakfast",
      minimum_version: "A few sips is enough to count.",
      tracking_question: "Did you have some water this morning?",
    },
    encouragement:
      "Some days, simple is exactly right. Do what you can and be kind to yourself.",
    safety_note:
      "This is a simple general routine, not medical or nutrition advice. Mellowa is not medical care, therapy or emergency support.",
  };
}
