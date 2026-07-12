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
}): Promise<DailyPlanOutputType> {
  const { profile, checkin, habits, date } = args;

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

  return generateStructuredJson({
    systemPrompt: DAILY_PLAN_SYSTEM_PROMPT,
    userPrompt: buildDailyPlanUserPrompt({
      profile: profileContext,
      checkin,
      habits,
      date,
    }),
    zodSchema: DailyPlanOutput,
    temperature: 0.6,
    maxTokens: 4096,
  });
}
