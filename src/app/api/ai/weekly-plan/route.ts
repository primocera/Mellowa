import { NextResponse } from "next/server";
import { startOfWeek, format, subDays } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { WeeklyPlanInput } from "@/schemas/wellbeing";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateWeeklyPlan } from "@/lib/ai/generate-weekly-plan";
import { AiGenerationError } from "@/lib/ai/errors";
import { canUsePremiumFeature, canGenerateWeeklyPlan } from "@/lib/stripe/subscription";
import { claimAiGeneration } from "@/lib/ai/rate-limit";
import { severeAllergyBlock } from "@/lib/safety/severe-allergy";
import {
  claimGenerationRequest,
  finishGenerationRequest,
  isValidIdempotencyKey,
} from "@/lib/ai/idempotency";
import type { DailyCheckin, WellbeingProfile } from "@/types/dailyflow";

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

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — notes are optional
  }

  const parsed = WeeklyPlanInput.safeParse(body ?? {});
  if (!parsed.success) {
    await finish("failed");
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const notes = parsed.data.notes;

  // Safety check on optional notes
  if (notes) {
    const safety = await checkInputSafety(user.id, "weekly-plan", notes);
    if (safety.should_block_generation) {
      await finish("failed");
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

  let plan;
  try {
    plan = await generateWeeklyPlan({
      profile: profile as WellbeingProfile,
      recentCheckins: (checkinsRes.data ?? []) as DailyCheckin[],
      habits: (habitsRes.data ?? []).map((h) => h.name),
      notes,
      weekStart,
    });
  } catch (err) {
    const code = err instanceof AiGenerationError ? err.code : "provider_error";
    await finish("failed");
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
    return NextResponse.json({ error: "Failed to save weekly plan" }, { status: 500 });
  }

  await finish("succeeded", saved.id);
  return NextResponse.json({ blocked: false, plan: saved });
}
