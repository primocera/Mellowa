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
import { getUserSubscriptionStatus } from "@/lib/stripe/subscription";
import { checkPlanIsToday } from "@/lib/today/mutation-guard";
import { trackEvent } from "@/lib/analytics";
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

  // Consent/abuse/rate-limit gate. Premium is enforced below per section:
  // meal regeneration is a provider call and stays Premium-only, while the
  // sample tier gets ONE lifetime curated (non-AI) section swap (MW-S07).
  const guard = await guardAiRoute(user.id, { requirePremium: false, route: "regenerate-section" });
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

  const sub = await getUserSubscriptionStatus(user.id);
  let sampleAdjustment = false;
  // Meal regeneration is a provider call and stays Premium-only. The sample tier
  // (one lifetime curated swap) only ever reaches the non-AI sections below. The
  // actual one-lifetime claim is made LATER — after every fail-closed read and
  // validation, immediately before the only mutation — so a failed read never has
  // to be compensated (see the claim block after the profile read).
  if (!sub.isPremium) {
    if (section_name === "meal_card") {
      await releaseReservation(eventId);
      return NextResponse.json(
        { error: "premium_required", scope: "ai" },
        { status: 402 }
      );
    }
  }

  // Plan must belong to the user (RLS also enforces this). A query ERROR is an
  // outage, not a missing plan — fail closed (503) rather than mutate from an
  // unobserved state. Only a successful no-row read is a genuine 404.
  const { data: plan, error: planError } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("id", plan_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (planError) {
    await releaseReservation(eventId);
    return NextResponse.json(
      {
        error: "data_unavailable",
        user_message:
          "We couldn't confirm today's plan just now — nothing was changed. Please try again in a moment.",
      },
      { status: 503 }
    );
  }
  if (!plan) {
    await releaseReservation(eventId);
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // MW-02: only today's canonical plan can be regenerated. A tab open across
  // local midnight, a wrong clock or a forged past/future target is refused
  // rather than mutating history (this is before the sample claim, so there is
  // nothing to refund).
  const dayState = await checkPlanIsToday(supabase, user.id, plan.plan_date as string);
  if (dayState === "unavailable") {
    // MW-03: timezone read outage — fail closed (no claim has been made yet).
    await releaseReservation(eventId);
    return NextResponse.json(
      {
        error: "data_unavailable",
        user_message:
          "We couldn't confirm today's plan just now — nothing was changed. Please try again in a moment.",
      },
      { status: 503 }
    );
  }
  if (dayState !== "ok") {
    await releaseReservation(eventId);
    return NextResponse.json(
      {
        error: "stale_day",
        user_message:
          "Your day has moved on since this page loaded, so this plan is no longer today's. Refresh to adjust today's plan.",
      },
      { status: 409 }
    );
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

  // The profile carries required safety/context facts: allergies and food
  // preferences for meal cards, movement limitations for movement moments. One
  // consistent fail-closed policy for every section: a read ERROR is an outage
  // (503) and a verified-absent profile means onboarding is incomplete (400).
  // We never fall back to an empty allergy list or pick a "safe" replacement
  // while the limitations read is unavailable.
  const { data: profile, error: profileError } = await supabase
    .from("wellbeing_profiles")
    .select(
      "primary_goal, cooking_time, cooking_skill, budget_level, movement_level, movement_limitations, food_preferences, allergies, preferred_tone"
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) {
    await releaseReservation(eventId);
    return NextResponse.json(
      {
        error: "data_unavailable",
        user_message:
          "We couldn't confirm your wellbeing profile just now — nothing was changed. Please try again in a moment.",
      },
      { status: 503 }
    );
  }
  if (!profile) {
    await releaseReservation(eventId);
    return NextResponse.json(
      {
        error: "onboarding_required",
        user_message:
          "Let's finish your wellbeing setup first — nothing was changed.",
      },
      { status: 400 }
    );
  }

  // Sample tier: claim the one-lifetime curated adjustment NOW — after every
  // fail-closed read and validation above, and immediately before the only
  // mutation. The claim is an atomic conditional update (succeeds only while
  // sample_adjustment_used_at is null; server-enforced, disclosed in copy).
  // A claim RPC ERROR is an outage, NEVER "already used": fail closed (503),
  // call no provider and consume no entitlement. A verified no-row means the
  // single lifetime allowance is genuinely already spent (402).
  if (!sub.isPremium) {
    const { data: claimed, error: claimError } = await supabase
      .from("wellbeing_profiles")
      .update({ sample_adjustment_used_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("sample_adjustment_used_at", null)
      .select("user_id")
      .maybeSingle();
    if (claimError) {
      await releaseReservation(eventId);
      return NextResponse.json(
        {
          error: "data_unavailable",
          user_message:
            "We couldn't confirm your free sample just now — nothing was changed. Please try again in a moment.",
        },
        { status: 503 }
      );
    }
    if (!claimed) {
      await releaseReservation(eventId);
      return NextResponse.json(
        { error: "sample_adjustment_used", scope: "ai" },
        { status: 402 }
      );
    }
    sampleAdjustment = true;
  }

  // Compensate a committed sample claim when the single mutation that follows it
  // fails. Idempotent (re-clearing an already-null timestamp is a no-op, so a
  // retry never grants extra allowance) and VERIFIED: if the compensation write
  // itself errors we do NOT report "nothing changed" — we log an operational
  // breadcrumb (ids only, no plan content) and the caller surfaces an explicit
  // repairable state so the allowance can be restored.
  const refundSampleAdjustment = async (): Promise<boolean> => {
    if (!sampleAdjustment) return true;
    const { error: refundError } = await supabase
      .from("wellbeing_profiles")
      .update({ sample_adjustment_used_at: null })
      .eq("user_id", user.id);
    if (refundError) {
      console.error("[sample-claim] refund unverified — allowance may be stuck", {
        userId: user.id,
        eventId,
        section: section_name,
      });
      return false;
    }
    return true;
  };

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
          limitations: profile.movement_limitations,
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
      // The claim was committed just above but the swap did not save. Refund the
      // one-lifetime allowance. If the refund cannot be VERIFIED, do not claim
      // "nothing changed" — expose a repairable state so support can restore it.
      const refunded = await refundSampleAdjustment();
      if (!refunded) {
        return NextResponse.json(
          {
            error: "sample_claim_unresolved",
            repairable: true,
            user_message:
              "Something went wrong saving your change, and we couldn't confirm your free sample was returned. Please contact support and we'll restore it — you haven't lost it.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: "Failed to save section" }, { status: 500 });
    }
    if (sampleAdjustment) {
      // Server-confirmed: the sample user experienced one real adjustment.
      trackEvent("sample_value_action_completed", {
        userId: user.id,
        properties: { surface: "today" },
      });
    }
    return NextResponse.json({ blocked: false, section: curated, sample_adjustment: sampleAdjustment });
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
${JSON.stringify(profile, null, 2)}

Current content:
${JSON.stringify(currentContent ?? {}, null, 2)}

Plan summary for context:
${JSON.stringify(plan.plan_summary, null, 2)}

Return ONLY the regenerated part as a single JSON object matching the same shape. Keep it consistent with the rest of the plan and follow all Mellowa safety rules.`;

  // Combined deterministic gate (Prompts 5 + 13): allergens are zero-tolerance
  // and quality (banned language, required safety notes, usable steps) shares
  // the single allowed corrective retry, then we fail closed.
  const allergies = (profile.allergies ?? []).filter(Boolean);
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
      route: "regenerate-section",
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
      route: "regenerate-section",
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
