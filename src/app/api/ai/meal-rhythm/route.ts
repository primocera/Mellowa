import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateStructuredJson } from "@/lib/ai/generate-json";
import { AiGenerationError } from "@/lib/ai/errors";
import {
  MEAL_RHYTHM_SYSTEM_PROMPT,
  buildMealRhythmUserPrompt,
} from "@/prompts/meal-rhythm";
import { MealRhythmOutput } from "@/schemas/ai-output";
import { guardAiRoute } from "@/lib/ai/guard";

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

  // Premium-only + rate limit — protects the AI provider key.
  const guard = await guardAiRoute(user.id, { requirePremium: true, route: "meal-rhythm" });
  if (guard) return guard;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // optional body
  }

  const parsed = MealRhythmInput.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const challenge = parsed.data.challenge;

  if (challenge) {
    const safety = await checkInputSafety(user.id, "meal-rhythm", challenge);
    if (safety.should_block_generation) {
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

  let ideas;
  try {
    ideas = await generateStructuredJson({
      systemPrompt: MEAL_RHYTHM_SYSTEM_PROMPT,
      userPrompt: buildMealRhythmUserPrompt({
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
      }),
      zodSchema: MealRhythmOutput,
      temperature: 0.7,
      maxTokens: 4096,
    });
  } catch (err) {
    const code = err instanceof AiGenerationError ? err.code : "provider_error";
    return NextResponse.json(
      { error: "Meal rhythm generation failed", code },
      { status: 502 }
    );
  }

  // Save ideas for later reference
  await supabase.from("meal_ideas").insert({
    user_id: user.id,
    title: ideas.title,
    meal_type: "meal_rhythm_set",
    idea: ideas,
  });


  return NextResponse.json({ blocked: false, ideas });
}
