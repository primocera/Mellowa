import "server-only";
import { generateStructuredJson, type UsageSink } from "@/lib/ai/generate-json";
import {
  LOW_ENERGY_DAY_SYSTEM_PROMPT,
  buildLowEnergyDayUserPrompt,
} from "@/prompts/low-energy-day";
import {
  LowEnergyDayOutput,
  type LowEnergyDayOutputType,
} from "@/schemas/low-energy-day";
import type { WellbeingProfile } from "@/types/dailyflow";

export async function generateLowEnergyDay(args: {
  profile: WellbeingProfile;
  checkin: Record<string, unknown> | null;
  availableTime: string;
  foodAvailable: string;
  mustDoTask: string;
  notes: string;
  extraInstruction?: string;
  usageSink?: UsageSink;
}): Promise<LowEnergyDayOutputType> {
  const { profile, checkin } = args;

  const profileContext = {
    primary_goal: profile.primary_goal,
    food_preferences: profile.food_preferences,
    allergies: profile.allergies,
    cooking_time: profile.cooking_time,
    cooking_skill: profile.cooking_skill,
    budget_level: profile.budget_level,
    movement_limitations: profile.movement_limitations,
    stress_reset_preference: profile.stress_reset_preference,
    preferred_tone: profile.preferred_tone,
  };

  const basePrompt = buildLowEnergyDayUserPrompt({
    profile: profileContext,
    checkin,
    availableTime: args.availableTime,
    foodAvailable: args.foodAvailable,
    mustDoTask: args.mustDoTask,
    notes: args.notes,
  });

  return generateStructuredJson({
    systemPrompt: LOW_ENERGY_DAY_SYSTEM_PROMPT,
    userPrompt: args.extraInstruction
      ? `${basePrompt}\n\nIMPORTANT CORRECTION: ${args.extraInstruction}`
      : basePrompt,
    zodSchema: LowEnergyDayOutput,
    temperature: 0.6,
    maxTokens: 4096,
    usageSink: args.usageSink,
  });
}
