import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateStructuredJson } from "@/lib/ai/generate-json";
import { AiGenerationError } from "@/lib/ai/errors";
import { DAILY_PLAN_V2_SYSTEM_PROMPT } from "@/prompts/daily-plan-v2";
import {
  MealCardSchema,
  MovementMomentSchema,
  mealTypes,
  PlanSectionSchemas,
} from "@/schemas/ai-output-v2";
import type { MealCardType } from "@/schemas/ai-output-v2";
import { guardAiRoute } from "@/lib/ai/guard";
import type { UsageSink } from "@/lib/ai/generate-json";
import { finalizeAiUsage, releaseReservation, sumUsage } from "@/lib/ai/usage";
import { promptVersionId } from "@/prompts/versions";
import { checkRegeneratedMealOutput, correctiveInstruction } from "@/lib/ai/output-guards";
import {
  findMealAllergenViolations,
  allergenExclusionInstruction,
} from "@/lib/safety/allergens";
import {
  pickBreathing,
  pickRelaxation,
  pickMovement,
  pickEvening,
} from "@/lib/content/wellbeing-library";

// Which daily_plans column each regeneratable section maps to.
const SECTION_COLUMN = {
  meal_card: "meal_cards",
  movement_moment: "movement_plan",
  breathing_exercise: "breathing_exercise",
  relaxation_technique: "relaxation_technique",
  evening_wind_down: "evening_routine",
} as const;

const SECTION_SCHEMAS = {
  meal_card: MealCardSchema,
  movement_moment: MovementMomentSchema,
  breathing_exercise: PlanSectionSchemas.breathing_exercise,
  relaxation_technique: PlanSectionSchemas.relaxation_technique,
  evening_wind_down: PlanSectionSchemas.evening_wind_down,
} as const;

const RegenerateInput = z
  .object({
    plan_id: z.string().uuid(),
    section_name: z.enum([
      "meal_card",
      "movement_moment",
      "breathing_exercise",
      "relaxation_technique",
      "evening_wind_down",
    ]),
    // Required only for meal_card.
    meal_type: z.enum(mealTypes).optional(),
    reason: z.enum([
      "simplify",
      "different_meals",
      "less_time",
      "lower_energy",
      "make_easier",
      "custom",
    ]),
    user_note: z.string().max(1000).optional().default(""),
  })
  .refine((v) => v.section_name !== "meal_card" || !!v.meal_type, {
    message: "meal_type is required when regenerating a meal_card",
  });

const REASON_INSTRUCTIONS: Record<string, string> = {
  simplify: "Make this simpler and lighter — fewer steps, easier options.",
  different_meals: "Suggest a different meal with similar effort and budget.",
  less_time: "The user has less time. Make it shorter and easier.",
  lower_energy: "The user's energy is lower than expected. Make it gentler.",
  make_easier: "Make this gentler and easier to do.",
  custom: "Follow the user's note below.",
};

const PROMPT_VERSION = promptVersionId("daily-plan-v2");

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Premium-only + rate limit — regeneration is a provider call.
  const guard = await guardAiRoute(user.id, { requirePremium: true, route: "regenerate-section" });
  if (guard instanceof NextResponse) return guard;
  const eventId = guard.eventId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await releaseReservation(eventId);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RegenerateInput.safeParse(body);
  if (!parsed.success) {
    await releaseReservation(eventId);
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { plan_id, section_name, meal_type, reason, user_note } = parsed.data;

  // Plan must belong to the user (RLS also enforces this)
  const { data: plan } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("id", plan_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!plan) {
    await releaseReservation(eventId);
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Safety check on the free-text note
  if (user_note) {
    const safety = await checkInputSafety(user.id, "regenerate-section", user_note);
    if (safety.should_block_generation) {
      await finalizeAiUsage(eventId, { status: "safety_blocked", promptVersion: PROMPT_VERSION });
      return NextResponse.json(
        { blocked: true, user_message: safety.user_message },
        { status: 200 }
      );
    }
  }

  const { data: profile } = await supabase
    .from("wellbeing_profiles")
    .select(
      "primary_goal, cooking_time, cooking_skill, budget_level, movement_level, movement_limitations, food_preferences, allergies, preferred_tone"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  // Prompts 7/8/9: curated sections are served from the reviewed library —
  // no provider call, instant, and always safe wording. A time-based seed
  // gives a different pick on each tap.
  if (section_name !== "meal_card") {
    const seed = `${user.id}:${Date.now()}`;
    let curated: unknown;
    switch (section_name) {
      case "breathing_exercise":
        curated = pickBreathing(seed);
        break;
      case "relaxation_technique":
        curated = pickRelaxation(seed);
        break;
      case "movement_moment":
        curated = pickMovement(seed, {
          limitations: profile?.movement_limitations,
          lowEnergy: reason === "lower_energy" || reason === "make_easier",
        });
        break;
      case "evening_wind_down":
        curated = pickEvening(seed, null);
        break;
    }
    const { error: curatedError } = await supabase
      .from("daily_plans")
      .update({ [SECTION_COLUMN[section_name]]: curated })
      .eq("id", plan_id)
      .eq("user_id", user.id);
    // Curated content = no provider call; release the reservation.
    await releaseReservation(eventId);
    if (curatedError) {
      return NextResponse.json({ error: "Failed to save section" }, { status: 500 });
    }
    return NextResponse.json({ blocked: false, section: curated });
  }

  // Only meal cards reach the AI path — everything else was served curated.
  const currentContent = (plan.meal_cards as MealCardType[] | null)?.find(
    (m) => m.meal_type === meal_type
  );

  const schema = SECTION_SCHEMAS[section_name];
  const targetDescription = `the ${meal_type} meal card (full meal card with ingredients, steps and approximate macros)`;

  const userPrompt = `The user has an existing daily plan and wants ONE part regenerated.

Regenerate: ${targetDescription}
Reason: ${REASON_INSTRUCTIONS[reason]}
${user_note ? `User note: """${user_note}"""` : ""}

User profile (respect allergies, preferences, cooking skill and limitations):
${JSON.stringify(profile ?? {}, null, 2)}

Current content:
${JSON.stringify(currentContent ?? {}, null, 2)}

Plan summary for context:
${JSON.stringify(plan.plan_summary, null, 2)}

Return ONLY the regenerated part as a single JSON object matching the same shape. Keep it consistent with the rest of the plan and follow all Mellowa safety rules.`;

  // Combined deterministic gate (Prompts 5 + 13): allergens are zero-tolerance
  // and quality (banned language, required safety notes, usable steps) shares
  // the single allowed corrective retry, then we fail closed.
  const allergies = (profile?.allergies ?? []).filter(Boolean);
  const gateReasons = (meal: MealCardType): { allergen: string[]; quality: string[] } => {
    const allergen = allergies.length
      ? findMealAllergenViolations(meal, allergies).map((v) => v.category)
      : [];
    const q = checkRegeneratedMealOutput(meal);
    return { allergen, quality: q.ok ? [] : q.reasons };
  };

  const sink1: UsageSink = {};
  const sink2: UsageSink = {};
  let retried = false;
  let regenerated;
  try {
    regenerated = await generateStructuredJson({
      systemPrompt: DAILY_PLAN_V2_SYSTEM_PROMPT,
      userPrompt,
      zodSchema: schema,
      temperature: 0.7,
      maxTokens: 3072,
      usageSink: sink1,
    });

    let gate = gateReasons(regenerated as MealCardType);
    if (gate.allergen.length || gate.quality.length) {
      retried = true;
      console.error("[safety] regenerated meal failed gate, retrying", {
        allergen: gate.allergen,
        quality: gate.quality,
      });
      regenerated = await generateStructuredJson({
        systemPrompt: DAILY_PLAN_V2_SYSTEM_PROMPT,
        userPrompt: `${userPrompt}

IMPORTANT CORRECTION: ${correctiveInstruction([
          ...gate.allergen.map((c) => `allergen:${c}`),
          ...gate.quality,
        ])}${gate.allergen.length ? `

${allergenExclusionInstruction(allergies)}` : ""}`,
        zodSchema: schema,
        temperature: 0.5,
        maxTokens: 3072,
        usageSink: sink2,
      });
      gate = gateReasons(regenerated as MealCardType);
      if (gate.allergen.length || gate.quality.length) {
        console.error("[safety] regenerated meal failed gate after retry, failing closed", {
          allergen: gate.allergen,
          quality: gate.quality,
        });
        await finalizeAiUsage(eventId, {
          status: gate.allergen.length ? "safety_blocked" : "quality_failed",
          promptVersion: PROMPT_VERSION,
          usage: sumUsage([sink1.usage, sink2.usage], "quality_failed"),
          retryCount: 1,
        });
        return NextResponse.json(
          {
            error: gate.allergen.length ? "allergen_check_failed" : "quality_check_failed",
            user_message:
              "We couldn't create a replacement we're confident is right for you, so we kept your current one. Please try again.",
          },
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
      { error: "Regeneration failed", code },
      { status: 502 }
    );
  }

  // Persist: replace the matching entry in the meal_cards array.
  const cards = ((plan.meal_cards as MealCardType[] | null) ?? []).map((m) =>
    m.meal_type === meal_type ? (regenerated as MealCardType) : m
  );
  const updatePayload: Record<string, unknown> = { meal_cards: cards };

  const { error: updateError } = await supabase
    .from("daily_plans")
    .update(updatePayload)
    .eq("id", plan_id)
    .eq("user_id", user.id);

  const finalUsage = {
    status: "success" as const,
    promptVersion: PROMPT_VERSION,
    usage: sumUsage([sink1.usage, sink2.usage], "success"),
    retryCount: retried ? 1 : 0,
  };
  if (updateError) {
    await finalizeAiUsage(eventId, finalUsage);
    return NextResponse.json({ error: "Failed to save section" }, { status: 500 });
  }

  await finalizeAiUsage(eventId, { ...finalUsage, resultId: plan_id });
  return NextResponse.json({ blocked: false, section: regenerated });
}
