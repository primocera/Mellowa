import { z } from "zod";

/**
 * Structured AI outputs. Strict enough to render UI safely — every section
 * has a title and small list of concrete, gentle steps.
 */

const PlanItem = z.object({
  title: z.string(),
  description: z.string().default(""),
  time_hint: z.string().default(""),
});

const PlanSection = z.object({
  title: z.string(),
  items: z.array(PlanItem).min(1).max(6),
});

export const DailyPlanOutput = z.object({
  plan_summary: z.object({
    title: z.string(),
    summary: z.string(),
  }),
  morning_routine: PlanSection,
  meal_rhythm: PlanSection,
  hydration_plan: PlanSection,
  movement_plan: PlanSection,
  stress_reset: PlanSection,
  focus_plan: PlanSection,
  evening_routine: PlanSection,
  habit_focus: z.object({
    title: z.string(),
    habit: z.string(),
    minimum_version: z.string().default(""),
  }),
  encouragement: z.string(),
  safety_note: z.string().default(""),
});

export type DailyPlanOutputType = z.infer<typeof DailyPlanOutput>;

const ShoppingItem = z.object({
  item: z.string(),
  quantity: z.string().default(""),
  category: z.string().default(""),
});

const MealDay = z.object({
  day: z.string(),
  breakfast: z.string().default(""),
  lunch: z.string().default(""),
  dinner: z.string().default(""),
  snack: z.string().default(""),
});

export const WeeklyPlanOutput = z.object({
  weekly_focus: z.string(),
  meal_structure: z.object({
    title: z.string(),
    days: z.array(MealDay).min(1).max(7),
    notes: z.string().default(""),
  }),
  shopping_list: z.object({
    title: z.string(),
    items: z.array(ShoppingItem).max(60),
  }),
  movement_plan: PlanSection,
  stress_reset_plan: PlanSection,
  habit_plan: z.object({
    title: z.string(),
    focus_habit: z.string(),
    minimum_version: z.string().default(""),
    tips: z.array(z.string()).max(5).default([]),
  }),
  low_energy_backup_plan: PlanSection,
  weekly_review_questions: z.array(z.string()).min(1).max(6),
});

export type WeeklyPlanOutputType = z.infer<typeof WeeklyPlanOutput>;

export const MealRhythmOutput = z.object({
  title: z.string(),
  ideas: z
    .array(
      z.object({
        meal_type: z.string(),
        title: z.string(),
        description: z.string().default(""),
        prep_time: z.string().default(""),
      })
    )
    .min(1)
    .max(12),
  notes: z.string().default(""),
});

export type MealRhythmOutputType = z.infer<typeof MealRhythmOutput>;

export const HabitPlanOutput = z.object({
  title: z.string(),
  habits: z
    .array(
      z.object({
        name: z.string(),
        category: z.string().default(""),
        frequency: z.string().default("daily"),
        minimum_version: z.string(),
        why_it_helps: z.string().default(""),
      })
    )
    .min(1)
    .max(5),
});

export type HabitPlanOutputType = z.infer<typeof HabitPlanOutput>;

export const JournalReflectionOutput = z.object({
  reflection: z.string(),
  gentle_question: z.string(),
  one_small_action: z.string(),
});

export type JournalReflectionOutputType = z.infer<typeof JournalReflectionOutput>;
