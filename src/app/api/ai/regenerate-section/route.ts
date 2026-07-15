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
import { recordAiUsage } from "@/lib/ai/rate-limit";
import {
  findMealAllergenViolations,
  allergenExclusionInstruction,
} from "@/lib/safety/allergens";

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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Premium-only + rate limit — regeneration is a provider call.
  const guard = await guardAiRoute(user.id, { requirePremium: true });
  if (guard) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RegenerateInput.safeParse(body);
  if (!parsed.success) {
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

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  // Safety check on the free-text note
  if (user_note) {
    const safety = await checkInputSafety(user.id, "regenerate-section", user_note);
    if (safety.should_block_generation) {
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

  // Current content of the section being regenerated.
  const column = SECTION_COLUMN[section_name];
  const currentContent =
    section_name === "meal_card"
      ? (plan.meal_cards as MealCardType[] | null)?.find(
          (m) => m.meal_type === meal_type
        )
      : plan[column];

  const schema = SECTION_SCHEMAS[section_name];
  const targetDescription =
    section_name === "meal_card"
      ? `the ${meal_type} meal card (full meal card with ingredients, steps and approximate macros)`
      : section_name.replace(/_/g, " ");

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

  let regenerated;
  try {
    regenerated = await generateStructuredJson({
      systemPrompt: DAILY_PLAN_V2_SYSTEM_PROMPT,
      userPrompt,
      zodSchema: schema,
      temperature: 0.7,
      maxTokens: 3072,
    });

    // Deterministic allergen gate for regenerated meals (Prompt 5).
    const allergies = (profile?.allergies ?? []).filter(Boolean);
    if (section_name === "meal_card" && allergies.length) {
      let violations = findMealAllergenViolations(
        regenerated as MealCardType,
        allergies
      );
      if (violations.length) {
        console.error("[safety] allergen violation in regenerated meal, retrying", {
          categories: violations.map((v) => v.category),
        });
        regenerated = await generateStructuredJson({
          systemPrompt: DAILY_PLAN_V2_SYSTEM_PROMPT,
          userPrompt: `${userPrompt}\n\n${allergenExclusionInstruction(allergies)}`,
          zodSchema: schema,
          temperature: 0.5,
          maxTokens: 3072,
        });
        violations = findMealAllergenViolations(
          regenerated as MealCardType,
          allergies
        );
        if (violations.length) {
          console.error("[safety] allergen violation after retry, failing closed", {
            categories: violations.map((v) => v.category),
          });
          return NextResponse.json(
            {
              error: "allergen_check_failed",
              user_message:
                "We couldn't create a replacement meal that we're confident avoids your listed allergies, so we kept your current one. Please try again.",
            },
            { status: 502 }
          );
        }
      }
    }
  } catch (err) {
    const code = err instanceof AiGenerationError ? err.code : "provider_error";
    return NextResponse.json(
      { error: "Regeneration failed", code },
      { status: 502 }
    );
  }

  // Persist: meal cards replace one entry in the array; others replace the column.
  let updatePayload: Record<string, unknown>;
  if (section_name === "meal_card") {
    const cards = ((plan.meal_cards as MealCardType[] | null) ?? []).map((m) =>
      m.meal_type === meal_type ? (regenerated as MealCardType) : m
    );
    updatePayload = { meal_cards: cards };
  } else {
    updatePayload = { [column]: regenerated };
  }

  const { error: updateError } = await supabase
    .from("daily_plans")
    .update(updatePayload)
    .eq("id", plan_id)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to save section" }, { status: 500 });
  }

  await recordAiUsage(user.id, "regenerate-section");

  return NextResponse.json({ blocked: false, section: regenerated });
}
