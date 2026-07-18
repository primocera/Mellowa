import "server-only";
import { generateStructuredJson } from "@/lib/ai/generate-json";
import {
  DAILY_PLAN_SYSTEM_PROMPT,
  buildDailyPlanUserPrompt,
} from "@/prompts/daily-plan";
import { DailyPlanOutput, type DailyPlanOutputType } from "@/schemas/ai-output";
import type { DailyCheckinInputType } from "@/schemas/wellbeing";
import type { WellbeingProfile } from "@/types/dailyflow";

export async function generateDailyPlan(args: {
  profile: WellbeingProfile;
  checkin: DailyCheckinInputType;
  habits: string[];
  date: string;
  /** Extra corrective instruction, e.g. after a failed quality check. */
  extraInstruction?: string;
}): Promise<DailyPlanOutputType> {
  const { profile, checkin, habits, date, extraInstruction } = args;

  const profileContext = {
    primary_goal: profile.primary_goal,
    wake_time: profile.wake_time,
    sleep_time: profile.sleep_time,
    work_schedule: profile.work_schedule,
    food_preferences: profile.food_preferences,
    allergies: profile.allergies,
    cooking_time: profile.cooking_time,
    budget_level: profile.budget_level,
    movement_level: profile.movement_level,
    preferred_tone: profile.preferred_tone,
  };

  const basePrompt = buildDailyPlanUserPrompt({
    profile: profileContext,
    checkin,
    habits,
    date,
  });

  return generateStructuredJson({
      route: "daily-plan",
    systemPrompt: DAILY_PLAN_SYSTEM_PROMPT,
    userPrompt: extraInstruction
      ? `${basePrompt}\n\nIMPORTANT CORRECTION: ${extraInstruction}`
      : basePrompt,
    zodSchema: DailyPlanOutput,
    temperature: 0.6,
    maxTokens: 4096,
  });
}
