import { z } from "zod";

// ---------- Low-Energy Day generator (Prompt 9) ----------

export const LowEnergyDayInput = z.object({
  available_time: z.string().max(200).default(""),
  food_available: z.string().max(500).default(""),
  must_do_task: z.string().max(300).default(""),
  notes: z.string().max(1000).default(""),
});

export type LowEnergyDayInputType = z.infer<typeof LowEnergyDayInput>;

const MinimumDayItemSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  time_hint: z.string().default(""),
});

const EasyMealSchema = z.object({
  meal: z.string(),
  idea: z.string(),
  why_it_fits: z.string().default(""),
});

export const LowEnergyDayOutput = z.object({
  title: z.string(),
  message: z.string(),
  minimum_day_plan: z.array(MinimumDayItemSchema).min(2).max(6),
  easy_meals: z.array(EasyMealSchema).min(1).max(4),
  one_reset: z.object({
    title: z.string(),
    steps: z.array(z.string()).min(1),
    duration: z.string().default(""),
  }),
  one_tiny_habit: z.object({
    habit: z.string(),
    minimum_version: z.string(),
  }),
  evening_recovery: z.array(z.string()).min(1),
  encouragement: z.string(),
  safety_note: z.string().default(""),
});

export type LowEnergyDayOutputType = z.infer<typeof LowEnergyDayOutput>;
