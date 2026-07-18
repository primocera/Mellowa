import "server-only";
import { generateStructuredJson, type UsageSink } from "@/lib/ai/generate-json";
import {
  WEEKLY_PLAN_SYSTEM_PROMPT,
  buildWeeklyPlanUserPrompt,
} from "@/prompts/weekly-plan";
import { WeeklyPlanOutput, type WeeklyPlanOutputType } from "@/schemas/ai-output";
import type { DailyCheckin, WellbeingProfile } from "@/types/dailyflow";

export async function generateWeeklyPlan(args: {
  profile: WellbeingProfile;
  recentCheckins: DailyCheckin[];
  habits: string[];
  notes: string;
  weekStart: string;
  extraInstruction?: string;
  usageSink?: UsageSink;
}): Promise<WeeklyPlanOutputType> {
  const { profile, recentCheckins, habits, notes, weekStart, extraInstruction, usageSink } = args;

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

  const checkinContext = recentCheckins.map((c) => ({
    date: c.checkin_date,
    energy: c.energy_level,
    mood: c.mood_level,
    stress: c.stress_level,
    sleep: c.sleep_quality,
  }));

  const basePrompt = buildWeeklyPlanUserPrompt({
    profile: profileContext,
    recentCheckins: checkinContext,
    habits,
    notes,
    weekStart,
  });

  return generateStructuredJson({
    systemPrompt: WEEKLY_PLAN_SYSTEM_PROMPT,
    userPrompt: extraInstruction
      ? `${basePrompt}

IMPORTANT CORRECTION: ${extraInstruction}`
      : basePrompt,
    zodSchema: WeeklyPlanOutput,
    temperature: 0.6,
    maxTokens: 8192,
    usageSink,
  });
}
