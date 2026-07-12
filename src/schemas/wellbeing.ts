import { z } from "zod";

export const levelScale = z.number().int().min(1).max(5);

export const primaryGoals = [
  "more_energy",
  "better_meal_rhythm",
  "less_overwhelm",
  "better_sleep_routine",
  "habit_consistency",
  "general_wellbeing_structure",
] as const;

export const preferredTones = [
  "gentle",
  "direct",
  "minimal",
  "encouraging",
] as const;

export const WellbeingProfileInput = z.object({
  wake_time: z.string().min(1, "Pick a wake time"),
  sleep_time: z.string().min(1, "Pick a sleep time"),
  work_schedule: z.string().min(1, "Tell us your typical schedule"),
  primary_goal: z.enum(primaryGoals),
  food_preferences: z.array(z.string()).default([]),
  allergies: z.array(z.string()).default([]),
  cooking_time: z.enum(["under_15", "15_30", "30_60", "over_60"]),
  budget_level: z.enum(["low", "medium", "flexible"]),
  energy_baseline: levelScale,
  stress_baseline: levelScale,
  sleep_quality_baseline: levelScale,
  movement_level: z.enum(["mostly_sitting", "lightly_active", "active", "very_active"]),
  preferred_tone: z.enum(preferredTones),
  safety_acknowledged: z.literal(true, {
    error: "Please confirm you understand what Mellowa is (and isn't).",
  }),
});

export type WellbeingProfileInputType = z.infer<typeof WellbeingProfileInput>;

export const DailyCheckinInput = z.object({
  energy_level: levelScale,
  mood_level: levelScale,
  stress_level: levelScale,
  sleep_quality: levelScale,
  hunger_pattern: z.string().optional().default(""),
  time_available: z.string().optional().default(""),
  today_focus: z.string().optional().default(""),
  notes: z.string().max(2000).optional().default(""),
});

export type DailyCheckinInputType = z.infer<typeof DailyCheckinInput>;

export const HabitInput = z.object({
  name: z.string().min(1).max(120),
  category: z.string().optional().default(""),
  frequency: z.string().optional().default("daily"),
  minimum_version: z.string().optional().default(""),
});

export type HabitInputType = z.infer<typeof HabitInput>;

export const JournalInput = z.object({
  prompt: z.string().max(500).optional().default(""),
  answer: z.string().min(1).max(5000),
  mood_before: levelScale.optional(),
  mood_after: levelScale.optional(),
});

export type JournalInputType = z.infer<typeof JournalInput>;

export const WeeklyPlanInput = z.object({
  notes: z.string().max(2000).optional().default(""),
});

export type WeeklyPlanInputType = z.infer<typeof WeeklyPlanInput>;
