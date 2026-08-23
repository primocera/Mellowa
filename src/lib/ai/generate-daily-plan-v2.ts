import "server-only";
import { generateStructuredJson, type UsageSink } from "@/lib/ai/generate-json";
import {
  DAILY_PLAN_V2_SYSTEM_PROMPT,
  buildDailyPlanV2UserPrompt,
} from "@/prompts/daily-plan-v2";
import {
  DailyPlanV2Output,
  type DailyPlanV2OutputType,
} from "@/schemas/ai-output-v2";
import type { DailyCheckinInputType } from "@/schemas/wellbeing";
import type { WellbeingProfile } from "@/types/dailyflow";

export async function generateDailyPlanV2(args: {
  profile: WellbeingProfile;
  checkin: DailyCheckinInputType;
  habits: string[];
  date: string;
  /** Mode-specific block-selection instruction (Prompt 2). */
  modeInstruction?: string;
  /** Extra corrective instruction, e.g. after a failed quality check. */
  extraInstruction?: string;
  /**
   * Absolute wall-clock deadline (epoch ms) shared across every generation call
   * in one request, so the total provider time stays within the (user, day)
   * claim lease (WS-B). Omitted → only the per-attempt timeout applies.
   */
  deadline?: number;
  usageSink?: UsageSink;
}): Promise<DailyPlanV2OutputType> {
  const { profile, checkin, habits, date, modeInstruction, extraInstruction, deadline, usageSink } = args;

  const profileContext = {
    primary_goal: profile.primary_goal,
    wake_time: profile.wake_time,
    sleep_time: profile.sleep_time,
    work_schedule: profile.work_schedule,
    food_preferences: profile.food_preferences,
    allergies: profile.allergies,
    cooking_time: profile.cooking_time,
    cooking_skill: profile.cooking_skill,
    budget_level: profile.budget_level,
    movement_level: profile.movement_level,
    movement_preference: profile.movement_preference,
    movement_limitations: profile.movement_limitations,
    stress_reset_preference: profile.stress_reset_preference,
    meditation_experience: profile.meditation_experience,
    preferred_routine_length: profile.preferred_routine_length,
    macro_focus: profile.macro_focus,
    preferred_meal_prep_time: profile.preferred_meal_prep_time,
    preferred_tone: profile.preferred_tone,
    // Prompt 4 preferences.
    disliked_ingredients: profile.disliked_ingredients,
    kitchen_equipment: profile.kitchen_equipment,
    default_servings: profile.default_servings,
    meal_pattern: profile.meal_pattern,
    schedule_type: profile.schedule_type,
  };

  const basePrompt = buildDailyPlanV2UserPrompt({
    profile: profileContext,
    checkin,
    habits,
    date,
    modeInstruction,
  });

  return generateStructuredJson({
      route: "daily-plan",
    systemPrompt: DAILY_PLAN_V2_SYSTEM_PROMPT,
    userPrompt: extraInstruction
      ? `${basePrompt}\n\nIMPORTANT CORRECTION: ${extraInstruction}`
      : basePrompt,
    zodSchema: DailyPlanV2Output,
    temperature: 0.6,
    maxTokens: 8192,
    deadline,
    usageSink,
  });
}
