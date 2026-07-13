import { z } from "zod";

/**
 * Mellowa v2 structured AI outputs — richer daily plan with usable meal
 * cards (approximate macros + recipe steps), calm reset exercises and gentle
 * movement. Strict enough to render the Today 2.0 dashboard safely.
 *
 * Safety positioning: macros are ALWAYS approximate and never medical
 * nutrition therapy; movement and breathing carry caution notes.
 */

// ---------- Meal cards ----------

export const MacroSchema = z.object({
  calories: z.number().min(0),
  protein_g: z.number().min(0),
  carbs_g: z.number().min(0),
  fat_g: z.number().min(0),
  fiber_g: z.number().min(0).optional(),
});

export const IngredientSchema = z.object({
  name: z.string(),
  amount: z.string().default(""),
  optional: z.boolean().default(false),
});

export const mealTypes = ["breakfast", "lunch", "snack", "dinner"] as const;

export const MealCardSchema = z.object({
  meal_type: z.enum(mealTypes),
  title: z.string(),
  short_description: z.string().default(""),
  prep_time_minutes: z.number().min(0),
  cook_time_minutes: z.number().min(0),
  total_time_minutes: z.number().min(0),
  difficulty: z.enum(["easy", "medium"]),
  budget_level: z.enum(["low", "medium", "high"]),
  servings: z.number().min(1),
  ingredients: z.array(IngredientSchema).min(1),
  preparation_steps: z.array(z.string()).min(2),
  approximate_macros: MacroSchema,
  why_it_fits_today: z.string().default(""),
  low_energy_swap: z.string().default(""),
  vegetarian_swap: z.string().optional(),
  dairy_free_swap: z.string().optional(),
  gluten_free_swap: z.string().optional(),
  leftovers_tip: z.string().optional(),
  grocery_items: z.array(z.string()).default([]),
  safety_note: z
    .string()
    .default("Macros are approximate and not medical nutrition advice."),
});

export type MealCardType = z.infer<typeof MealCardSchema>;

// ---------- Movement ----------

export const MovementMomentSchema = z.object({
  title: z.string(),
  movement_type: z.enum([
    "walk",
    "stretch",
    "mobility",
    "strength",
    "desk_reset",
    "evening_release",
  ]),
  duration_minutes: z.number().min(2).max(45),
  intensity: z.enum(["very_gentle", "gentle", "moderate"]),
  best_time: z.string().default(""),
  equipment_needed: z.string().default("None"),
  steps: z.array(z.string()).min(2),
  modifications: z.array(z.string()).default([]),
  low_energy_version: z.string().default(""),
  caution_note: z
    .string()
    .default("Skip any movement that causes pain."),
});

export type MovementMomentType = z.infer<typeof MovementMomentSchema>;

// ---------- Calm reset exercises (library + plan) ----------

export const WellbeingExerciseSchema = z.object({
  title: z.string(),
  category: z.enum(["breathing", "meditation", "relaxation"]),
  duration_minutes: z.number().min(1).max(30),
  best_for: z.string().default(""),
  difficulty: z.enum(["easy", "medium"]),
  steps: z.array(z.string()).min(2),
  short_script: z.array(z.string()).optional(),
  when_to_use: z.string().default(""),
  caution_note: z.string().default(""),
});

export type WellbeingExerciseType = z.infer<typeof WellbeingExerciseSchema>;

// ---------- Plan sub-sections ----------

const BreathingSchema = z.object({
  name: z.string(),
  duration_minutes: z.number().min(1).max(30),
  when_to_use: z.string().default(""),
  steps: z.array(z.string()).min(2),
  gentle_note: z
    .string()
    .default("Stop if you feel dizzy or uncomfortable."),
});

const MeditationSchema = z.object({
  name: z.string(),
  duration_minutes: z.number().min(1).max(30),
  script: z.array(z.string()).min(1),
  journal_prompt: z.string().default(""),
});

const RelaxationSchema = z.object({
  name: z.string(),
  duration_minutes: z.number().min(1).max(30),
  steps: z.array(z.string()).min(2),
  best_for: z.string().default(""),
});

const HydrationSchema = z.object({
  goal: z.string(),
  timing: z.array(z.string()).min(1),
});

const FocusBlockSchema = z.object({
  main_task: z.string(),
  method: z.string().default(""),
  break_reminder: z.string().default(""),
});

const EveningWindDownSchema = z.object({
  time: z.string().default(""),
  steps: z.array(z.string()).min(1),
  simple_version: z.string().default(""),
});

const OneSmallHabitSchema = z.object({
  habit: z.string(),
  minimum_version: z.string(),
  tracking_question: z.string().default(""),
});

// ---------- Full daily plan v2 ----------

export const planIntensities = [
  "normal",
  "low_energy",
  "high_stress",
  "busy_day",
] as const;

export const DailyPlanV2Output = z.object({
  plan_summary: z.object({
    main_focus: z.string(),
    energy_match: z.string().default(""),
    short_note: z.string().default(""),
  }),
  plan_intensity: z.enum(planIntensities),
  meal_cards: z.array(MealCardSchema).min(1).max(4),
  hydration_plan: HydrationSchema,
  movement_moment: MovementMomentSchema,
  breathing_exercise: BreathingSchema,
  meditation_or_reflection: MeditationSchema,
  relaxation_technique: RelaxationSchema,
  focus_block: FocusBlockSchema,
  evening_wind_down: EveningWindDownSchema,
  one_small_habit: OneSmallHabitSchema,
  encouragement: z.string(),
  safety_note: z.string().default(""),
});

export type DailyPlanV2OutputType = z.infer<typeof DailyPlanV2Output>;

// Re-export section schemas for the regenerate-section route.
export const PlanSectionSchemas = {
  movement_moment: MovementMomentSchema,
  breathing_exercise: BreathingSchema,
  relaxation_technique: RelaxationSchema,
  evening_wind_down: EveningWindDownSchema,
} as const;
