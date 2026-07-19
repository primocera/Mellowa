import { NextResponse } from "next/server";
import { startOfWeek, format, subDays } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { WeeklyPlanInput } from "@/schemas/wellbeing";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateWeeklyPlan } from "@/lib/ai/generate-weekly-plan";
import type { UsageSink } from "@/lib/ai/generate-json";
import { finalizeAiUsage, releaseReservation } from "@/lib/ai/usage";
import { promptVersionId } from "@/prompts/versions";
import { AiGenerationError } from "@/lib/ai/errors";
import { canUsePremiumFeature, canGenerateWeeklyPlan } from "@/lib/stripe/subscription";
import { claimAiGeneration } from "@/lib/ai/rate-limit";
import { severeAllergyBlock } from "@/lib/safety/severe-allergy";
import { MealCardSchema } from "@/schemas/ai-output-v2";
import { findMealAllergenViolations } from "@/lib/safety/allergens";
import { trackEvent } from "@/lib/analytics";
import { checkWeeklyPlanOutput, correctiveInstruction } from "@/lib/ai/output-guards";
import { allergenExclusionInstruction } from "@/lib/safety/allergens";
import { sumUsage } from "@/lib/ai/usage";
import {
  claimGenerationRequest,
  finishGenerationRequest,
  isValidIdempotencyKey,
} from "@/lib/ai/idempotency";
import type { DailyCheckin, WellbeingProfile } from "@/types/dailyflow";

const PROMPT_VERSION = promptVersionId("weekly-plan");

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

  // Weekly plans are a premium feature; also enforce the monthly cap.
  if (!(await canUsePremiumFeature(user.id, "weekly_plan"))) {
    return NextResponse.json(
      { error: "upgrade_required", scope: "weekly_plan" },
      { status: 402 }
    );
  }
  if (!(await canGenerateWeeklyPlan(user.id))) {
    return NextResponse.json(
      { error: "limit_reached", scope: "weekly_plan" },
      { status: 402 }
    );
  }

  // Idempotency (v6 Prompt 7): one provider call per intentional request,
  // keyed per user/week so concurrent duplicates converge.
  const idemKey = request.headers.get("x-idempotency-key");
  const weekStartForClaim = format(
    startOfWeek(new Date(), { weekStartsOn: 1 }),
    "yyyy-MM-dd"
  );
  let requestId: string | null = null;
  if (isValidIdempotencyKey(idemKey)) {
    const idemClaim = await claimGenerationRequest(supabase, {
      userId: user.id,
      route: "weekly-plan",
      idempotencyKey: idemKey,
      localDate: weekStartForClaim,
    });
    if (!idemClaim.claimed) {
      if (idemClaim.status === "succeeded" && idemClaim.resultId) {
        const { data: existing } = await supabase
          .from("weekly_plans")
          .select("*")
          .eq("id", idemClaim.resultId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (existing) {
          return NextResponse.json({ blocked: false, plan: existing, deduplicated: true });
        }
      }
      return NextResponse.json(
        { error: "generation_in_progress", status: "in_progress" },
        { status: 409 }
      );
    }
    requestId = idemClaim.requestId;
  }
  const finish = (status: "succeeded" | "failed", resultId?: string | null) =>
    finishGenerationRequest(supabase, { requestId, userId: user.id, status, resultId });

  // Abuse guard — atomic per-user rate limit + global cost ceiling.
  const claim = await claimAiGeneration(user.id, "weekly-plan");
  if (!claim.ok) {
    await finish("failed");
    if (claim.scope === "capacity") {
      return NextResponse.json(
        {
          error: "capacity",
          user_message:
            "Mellowa is at capacity right now. Please try again a little later.",
          retryAfterMinutes: claim.retryAfterMinutes,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "rate_limited", scope: claim.scope, retryAfterMinutes: claim.retryAfterMinutes },
      { status: 429 }
    );
  }

  // Ledger row is reserved (claim.eventId). It is finalized with provider truth
  // on a real generation, or released if we exit before calling the provider.
  const usageSink: UsageSink = {};

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — notes are optional
  }

  const parsed = WeeklyPlanInput.safeParse(body ?? {});
  if (!parsed.success) {
    await finish("failed");
    await releaseReservation(claim.eventId);
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const notes = parsed.data.notes;

  // MW-S05: meal continuity — optional, user-editable preferences plus
  // allergen-validated favourite metadata. Only normalized fields (titles,
  // meal types, ingredient names) reach the prompt; saved notes never do.
  const allergiesEarly = ((profile.allergies as string[] | null) ?? []).filter(Boolean);
  const pantryItems = ((profile.pantry_items as string[] | null) ?? [])
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0 && s.length <= 40)
    .slice(0, 20);
  let favouritesMeta: { title: string; meal_type: string; ingredients: string[] }[] = [];
  if (profile.meal_reuse_favourites) {
    const { data: favRows } = await supabase
      .from("favourite_meals")
      .select("meal")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(8);
    for (const row of favRows ?? []) {
      const parsedMeal = MealCardSchema.safeParse(row.meal);
      if (!parsedMeal.success) continue;
      // Allergen re-validation: favourites saved before an allergy change
      // never reach generation.
      if (
        allergiesEarly.length &&
        findMealAllergenViolations(parsedMeal.data, allergiesEarly).length > 0
      ) {
        continue;
      }
      favouritesMeta.push({
        title: parsedMeal.data.title,
        meal_type: parsedMeal.data.meal_type,
        ingredients: parsedMeal.data.ingredients.map((i) => i.name).slice(0, 12),
      });
    }
    favouritesMeta = favouritesMeta.slice(0, 6);
  }
  const mealContinuity = {
    favourites: favouritesMeta,
    repeatLeftovers: !!profile.meal_repeat_leftovers,
    varietyLevel: (profile.meal_variety_level as string | null) ?? null,
    pantryItems,
  };

  // Safety check on ALL free-ish text that reaches the prompt: the weekly
  // note plus user-entered pantry item names.
  const safetyText = [notes, pantryItems.join(", ")].filter(Boolean).join("\n");
  if (safetyText) {
    const safety = await checkInputSafety(user.id, "weekly-plan", safetyText);
    if (safety.should_block_generation) {
      await finish("failed");
      await finalizeAiUsage(claim.eventId, { status: "safety_blocked", promptVersion: PROMPT_VERSION });
      return NextResponse.json(
        { blocked: true, user_message: safety.user_message },
        { status: 200 }
      );
    }
  }

  const since = format(subDays(new Date(), 14), "yyyy-MM-dd");
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");

  const [checkinsRes, habitsRes] = await Promise.all([
    supabase
      .from("daily_checkins")
      .select("*")
      .eq("user_id", user.id)
      .gte("checkin_date", since)
      .order("checkin_date", { ascending: false }),
    supabase
      .from("habits")
      .select("name")
      .eq("user_id", user.id)
      .eq("active", true),
  ]);

  const genArgs = {
    profile: profile as WellbeingProfile,
    recentCheckins: (checkinsRes.data ?? []) as DailyCheckin[],
    habits: (habitsRes.data ?? []).map((h) => h.name),
    notes,
    weekStart,
    mealContinuity,
  };
  const allergies = allergiesEarly;
  const retrySink: UsageSink = {};
  let retried = false;
  let plan;
  try {
    plan = await generateWeeklyPlan({ ...genArgs, usageSink });

    // Output quality + deterministic allergen gate (Prompt 13): one corrective
    // retry, then fail closed — an unsafe weekly plan is never saved.
    let quality = checkWeeklyPlanOutput(plan, allergies);
    if (!quality.ok) {
      retried = true;
      const hadAllergen = quality.reasons.some((r) => r.startsWith("allergen:"));
      plan = await generateWeeklyPlan({
        ...genArgs,
        usageSink: retrySink,
        extraInstruction: `${correctiveInstruction(quality.reasons)}${
          hadAllergen ? `

${allergenExclusionInstruction(allergies)}` : ""
        }`,
      });
      quality = checkWeeklyPlanOutput(plan, allergies);
      if (!quality.ok) {
        const failedOnAllergen = quality.reasons.some((r) => r.startsWith("allergen:"));
        await finish("failed");
        await finalizeAiUsage(claim.eventId, {
          status: failedOnAllergen ? "safety_blocked" : "quality_failed",
          promptVersion: PROMPT_VERSION,
          usage: sumUsage([usageSink.usage, retrySink.usage], "quality_failed"),
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
    await finish("failed");
    // The precise outcome (timeout/provider_error/invalid_json/schema_failed)
    // is captured in the sink; the provider may have been billed even on failure.
    const failStatus = retrySink.usage?.status ?? usageSink.usage?.status ?? "provider_error";
    await finalizeAiUsage(claim.eventId, {
      status: failStatus,
      promptVersion: PROMPT_VERSION,
      usage: sumUsage([usageSink.usage, retrySink.usage], failStatus),
      retryCount: retried ? 1 : 0,
    });
    return NextResponse.json(
      { error: "Weekly plan generation failed", code },
      { status: 502 }
    );
  }

  const { data: saved, error: saveError } = await supabase
    .from("weekly_plans")
    .insert({
      user_id: user.id,
      week_start: weekStart,
      weekly_focus: plan.weekly_focus,
      meal_structure: plan.meal_structure,
      shopping_list: plan.shopping_list,
      movement_plan: plan.movement_plan,
      stress_plan: plan.stress_reset_plan,
      habit_plan: plan.habit_plan,
      low_energy_backup_plan: plan.low_energy_backup_plan,
      review_questions: plan.weekly_review_questions,
    })
    .select()
    .single();

  if (saveError) {
    await finish("failed");
    // The provider call succeeded and was billed, so record the real cost even
    // though persistence failed — the row is truthful, just without a result_id.
    await finalizeAiUsage(claim.eventId, {
      status: "success",
      usage: sumUsage([usageSink.usage, retrySink.usage], "success"),
      promptVersion: PROMPT_VERSION,
      retryCount: retried ? 1 : 0,
    });
    return NextResponse.json({ error: "Failed to save weekly plan" }, { status: 500 });
  }

  await finish("succeeded", saved.id);
  if (favouritesMeta.length) {
    // Counts/categories only — never meal content.
    trackEvent("favourite_reused", { userId: user.id, properties: { surface: "week" } });
  }
  await finalizeAiUsage(claim.eventId, {
    status: "success",
    promptVersion: PROMPT_VERSION,
    usage: sumUsage([usageSink.usage, retrySink.usage], "success"),
    retryCount: retried ? 1 : 0,
    resultId: saved.id,
  });
  return NextResponse.json({ blocked: false, plan: saved });
}
