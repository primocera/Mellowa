import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateStructuredJson, type UsageSink } from "@/lib/ai/generate-json";
import { AiGenerationError } from "@/lib/ai/errors";
import {
  MEAL_RHYTHM_SYSTEM_PROMPT,
  buildMealRhythmUserPrompt,
} from "@/prompts/meal-rhythm";
import { MealRhythmOutput } from "@/schemas/ai-output";
import { guardAiRoute } from "@/lib/ai/guard";
import { severeAllergyBlock } from "@/lib/safety/severe-allergy";
import { finalizeAiUsage, releaseReservation, sumUsage } from "@/lib/ai/usage";
import { promptVersionId } from "@/prompts/versions";
import { checkMealRhythmOutput, correctiveInstruction } from "@/lib/ai/output-guards";
import { allergenExclusionInstruction } from "@/lib/safety/allergens";

const PROMPT_VERSION = promptVersionId("meal-rhythm");

const MealRhythmInput = z.object({
  challenge: z.string().max(500).optional().default(""),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("wellbeing_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: "onboarding_required" }, { status: 400 });
  }

  // Severe allergies: no specific meal generation (Prompt 8).
  const severeBlock = severeAllergyBlock(profile);
  if (severeBlock) return NextResponse.json(severeBlock, { status: 200 });

  // Premium-only + rate limit — protects the AI provider key.
  const guard = await guardAiRoute(user.id, { requirePremium: true, route: "meal-rhythm" });
  if (guard instanceof NextResponse) return guard;
  const eventId = guard.eventId;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // optional body
  }

  const parsed = MealRhythmInput.safeParse(body ?? {});
  if (!parsed.success) {
    await releaseReservation(eventId);
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const challenge = parsed.data.challenge;

  if (challenge) {
    const safety = await checkInputSafety(user.id, "meal-rhythm", challenge);
    if (safety.should_block_generation) {
      await finalizeAiUsage(eventId, { status: "safety_blocked", promptVersion: PROMPT_VERSION });
      return NextResponse.json(
        { blocked: true, user_message: safety.user_message },
        { status: 200 }
      );
    }
  }

  const { data: latestCheckin } = await supabase
    .from("daily_checkins")
    .select("energy_level")
    .eq("user_id", user.id)
    .order("checkin_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const userPrompt = buildMealRhythmUserPrompt({
    profile: {
      food_preferences: profile.food_preferences,
      allergies: profile.allergies,
      cooking_time: profile.cooking_time,
      budget_level: profile.budget_level,
      work_schedule: profile.work_schedule,
      primary_goal: profile.primary_goal,
    },
    challenge,
    latestEnergy: latestCheckin?.energy_level ?? null,
  });

  const allergies = (profile.allergies ?? []).filter(Boolean);
  const sink1: UsageSink = {};
  const sink2: UsageSink = {};
  let retried = false;
  let ideas;
  try {
    ideas = await generateStructuredJson({
      systemPrompt: MEAL_RHYTHM_SYSTEM_PROMPT,
      userPrompt,
      zodSchema: MealRhythmOutput,
      temperature: 0.7,
      maxTokens: 4096,
      usageSink: sink1,
    });

    // Output quality + deterministic allergen gate (Prompt 13): one corrective
    // retry, then fail closed — unsafe ideas are never saved or shown.
    let quality = checkMealRhythmOutput(ideas, allergies);
    if (!quality.ok) {
      retried = true;
      const hadAllergen = quality.reasons.some((r) => r.startsWith("allergen:"));
      ideas = await generateStructuredJson({
        systemPrompt: MEAL_RHYTHM_SYSTEM_PROMPT,
        userPrompt: `${userPrompt}\n\nIMPORTANT CORRECTION: ${correctiveInstruction(quality.reasons)}${
          hadAllergen ? `\n\n${allergenExclusionInstruction(allergies)}` : ""
        }`,
        zodSchema: MealRhythmOutput,
        temperature: 0.5,
        maxTokens: 4096,
        usageSink: sink2,
      });
      quality = checkMealRhythmOutput(ideas, allergies);
      if (!quality.ok) {
        const failedOnAllergen = quality.reasons.some((r) => r.startsWith("allergen:"));
        await finalizeAiUsage(eventId, {
          status: failedOnAllergen ? "safety_blocked" : "quality_failed",
          promptVersion: PROMPT_VERSION,
          usage: sumUsage([sink1.usage, sink2.usage], "quality_failed"),
          retryCount: 1,
        });
        return NextResponse.json(
          { error: "quality_check_failed", reasons: quality.reasons },
          { status: 502 }
        );
      }
    }
  } catch (err) {
    const code = err instanceof AiGenerationError ? err.code : "provider_error";
    const failStatus = sink2.usage?.status ?? sink1.usage?.status ?? "provider_error";
    await finalizeAiUsage(eventId, {
      status: failStatus,
      promptVersion: PROMPT_VERSION,
      usage: sumUsage([sink1.usage, sink2.usage], failStatus),
      retryCount: retried ? 1 : 0,
    });
    return NextResponse.json(
      { error: "Meal rhythm generation failed", code },
      { status: 502 }
    );
  }

  // Save ideas for later reference — only after they passed validation.
  const { data: savedIdea } = await supabase
    .from("meal_ideas")
    .insert({
      user_id: user.id,
      title: ideas.title,
      meal_type: "meal_rhythm_set",
      idea: ideas,
    })
    .select("id")
    .single();

  await finalizeAiUsage(eventId, {
    status: "success",
    promptVersion: PROMPT_VERSION,
    usage: sumUsage([sink1.usage, sink2.usage], "success"),
    retryCount: retried ? 1 : 0,
    resultId: savedIdea?.id ?? null,
  });
  return NextResponse.json({ blocked: false, ideas });
}
