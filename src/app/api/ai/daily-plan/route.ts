import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DailyCheckinInput } from "@/schemas/wellbeing";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateDailyPlanV2 } from "@/lib/ai/generate-daily-plan-v2";
import { resolvePlanMode, planModeInstruction } from "@/lib/ai/plan-mode";
import {
  findPlanAllergenViolations,
  allergenExclusionInstruction,
  ALLERGEN_DISCLAIMER,
} from "@/lib/safety/allergens";
import { checkDailyPlanV2Quality } from "@/lib/ai/quality-checks";
import { buildFallbackDailyPlan } from "@/lib/ai/fallback-plan";
import { AiGenerationError } from "@/lib/ai/errors";
import { canGenerateDailyPlan } from "@/lib/stripe/subscription";
import { guardAiRoute } from "@/lib/ai/guard";
import type { WellbeingProfile } from "@/types/dailyflow";

export async function POST(request: Request) {
  // 1. Authenticate
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Load wellbeing profile
  const { data: profile } = await supabase
    .from("wellbeing_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json(
      { error: "onboarding_required" },
      { status: 400 }
    );
  }

  // 3. Validate check-in input
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = DailyCheckinInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const checkin = parsed.data;

  // Plan gate — sample tier gets one lifetime preview, premium is unlimited.
  if (!(await canGenerateDailyPlan(user.id))) {
    return NextResponse.json(
      { error: "limit_reached", scope: "daily_plan" },
      { status: 402 }
    );
  }

  // Abuse guard — rate limit (sample allowance already checked above).
  const guard = await guardAiRoute(user.id, {
    requirePremium: false,
    route: "daily-plan",
  });
  if (guard) return guard;

  // 4. Safety check BEFORE any generation
  const freeText = [checkin.today_focus, checkin.notes, checkin.hunger_pattern]
    .filter(Boolean)
    .join("\n");
  const safety = await checkInputSafety(
    user.id,
    "daily-plan",
    freeText,
    (profile as WellbeingProfile).locale
  );

  // 5. Blocked → return safety message, no plan
  if (safety.should_block_generation) {
    return NextResponse.json(
      { blocked: true, user_message: safety.user_message },
      { status: 200 }
    );
  }

  // Prompt 3: prefer the client's local date so late-evening check-ins land
  // on the user's day, but only accept it within ±1 day of server time.
  const serverToday = new Date().toISOString().slice(0, 10);
  let today = serverToday;
  if (checkin.local_date) {
    const diffDays = Math.abs(
      (new Date(checkin.local_date).getTime() - new Date(serverToday).getTime()) /
        (24 * 60 * 60 * 1000)
    );
    if (diffDays <= 1) today = checkin.local_date;
  }

  // 6. Save the check-in
  const { data: savedCheckin, error: checkinError } = await supabase
    .from("daily_checkins")
    .insert({
      user_id: user.id,
      checkin_date: today,
      energy_level: checkin.energy_level,
      mood_level: checkin.mood_level,
      stress_level: checkin.stress_level,
      sleep_quality: checkin.sleep_quality,
      hunger_pattern: checkin.hunger_pattern,
      time_available: checkin.time_available,
      today_focus: checkin.today_focus,
      notes: checkin.notes,
      context: checkin.context || null,
      client_timezone: checkin.timezone || null,
    })
    .select()
    .single();

  if (checkinError) {
    return NextResponse.json(
      { error: "Failed to save check-in" },
      { status: 500 }
    );
  }

  // 7. Generate the plan
  const { data: habitRows } = await supabase
    .from("habits")
    .select("name")
    .eq("user_id", user.id)
    .eq("active", true);

  const habits = (habitRows ?? []).map((h) => h.name);
  const typedProfile = profile as WellbeingProfile;

  // Prompt 2: resolve the day mode and build its block-selection instruction.
  const mode = resolvePlanMode({
    requestedMode: checkin.mode,
    energy_level: checkin.energy_level,
    stress_level: checkin.stress_level,
    time_available: checkin.time_available,
  });
  const modeInstruction = planModeInstruction(mode, checkin.custom_areas);

  let plan;
  try {
    plan = await generateDailyPlanV2({
      profile: typedProfile,
      checkin,
      habits,
      date: today,
      modeInstruction,
    });

    // Quality gate — one safer regeneration attempt if the plan fails
    const quality = checkDailyPlanV2Quality(plan, {
      energy_level: checkin.energy_level,
      stress_level: checkin.stress_level,
    });
    if (!quality.ok) {
      console.error("[ai] daily plan failed quality check, regenerating", {
        reasons: quality.reasons,
      });
      plan = await generateDailyPlanV2({
        profile: typedProfile,
        checkin,
        habits,
        date: today,
        modeInstruction,
        extraInstruction: `The previous plan failed quality review (${quality.reasons.join(
          "; "
        )}). Create a LIGHTER, gentler plan: simpler meals with a clear safety note, gentle movement with a caution note, short calm-reset steps, no medical or diet language, warm encouragement, and a clear minimum version for the habit.`,
      });
      const retryQuality = checkDailyPlanV2Quality(plan, {
        energy_level: checkin.energy_level,
        stress_level: checkin.stress_level,
      });
      if (!retryQuality.ok) {
        return NextResponse.json(
          { error: "quality_check_failed", reasons: retryQuality.reasons },
          { status: 502 }
        );
      }
    }

    // Deterministic allergen gate (Prompt 5): never trust the prompt alone.
    // One regeneration with explicit exclusions; if it still fails, return a
    // safe error rather than a risky recipe.
    const allergies = (typedProfile.allergies ?? []).filter(Boolean);
    if (allergies.length) {
      let violations = findPlanAllergenViolations(plan.meal_cards, allergies);
      if (violations.length) {
        console.error("[safety] allergen violation, regenerating", {
          categories: violations.flatMap((v) =>
            v.violations.map((x) => x.category)
          ),
        });
        plan = await generateDailyPlanV2({
          profile: typedProfile,
          checkin,
          habits,
          date: today,
          modeInstruction,
          extraInstruction: allergenExclusionInstruction(allergies),
        });
        violations = findPlanAllergenViolations(plan.meal_cards, allergies);
        if (violations.length) {
          console.error("[safety] allergen violation after retry, failing closed", {
            categories: violations.flatMap((v) =>
              v.violations.map((x) => x.category)
            ),
          });
          return NextResponse.json(
            {
              error: "allergen_check_failed",
              user_message:
                "We couldn't create meals today that we're confident avoid your listed allergies, so we stopped rather than risk it. Please try again — and always double-check ingredient labels.",
            },
            { status: 502 }
          );
        }
      }
      // Make the limitation explicit on every plan for users with allergies.
      plan.safety_note = plan.safety_note
        ? `${plan.safety_note} ${ALLERGEN_DISCLAIMER}`
        : ALLERGEN_DISCLAIMER;
    }
  } catch (err) {
    const code = err instanceof AiGenerationError ? err.code : "provider_error";
    // Curated fallback (Prompt 16): rather than an error screen during a
    // provider outage, serve a gentle pre-written Minimum Day. It is static and
    // cannot honour an allergy list, so only offer it to users with none.
    const hasAllergies = (typedProfile.allergies ?? []).filter(Boolean).length > 0;
    if (!hasAllergies) {
      console.error("[ai] daily plan generation failed, serving fallback", { code });
      plan = buildFallbackDailyPlan();
    } else {
      return NextResponse.json(
        { error: "Plan generation failed", code },
        { status: 502 }
      );
    }
  }

  // 8. Save the plan. V2 sections map onto existing jsonb columns where they
  //    fit, plus the new v2-specific columns.
  const { data: savedPlan, error: planError } = await supabase
    .from("daily_plans")
    .insert({
      user_id: user.id,
      checkin_id: savedCheckin.id,
      plan_date: today,
      plan_summary: plan.plan_summary,
      plan_intensity: plan.plan_intensity,
      plan_mode: plan.plan_mode ?? mode,
      meal_cards: plan.meal_cards,
      hydration_plan_v2: plan.hydration_plan,
      movement_plan: plan.movement_moment ?? null,
      breathing_exercise: plan.breathing_exercise ?? null,
      meditation_or_reflection: plan.meditation_or_reflection ?? null,
      relaxation_technique: plan.relaxation_technique ?? null,
      focus_plan: plan.focus_block ?? null,
      evening_routine: plan.evening_wind_down ?? null,
      habit_focus: plan.one_small_habit ?? null,
      encouragement: plan.encouragement,
      safety_note: plan.safety_note,
    })
    .select()
    .single();

  if (planError) {
    return NextResponse.json({ error: "Failed to save plan" }, { status: 500 });
  }

  // 8b. Also persist each meal card to its own table for reuse.
  if (plan.meal_cards.length > 0) {
    await supabase.from("generated_meal_cards").insert(
      plan.meal_cards.map((meal) => ({
        user_id: user.id,
        daily_plan_id: savedPlan.id,
        meal_type: meal.meal_type,
        title: meal.title,
        short_description: meal.short_description,
        prep_time_minutes: meal.prep_time_minutes,
        cook_time_minutes: meal.cook_time_minutes,
        total_time_minutes: meal.total_time_minutes,
        difficulty: meal.difficulty,
        budget_level: meal.budget_level,
        servings: meal.servings,
        ingredients: meal.ingredients,
        preparation_steps: meal.preparation_steps,
        approximate_macros: meal.approximate_macros,
        swaps: {
          low_energy: meal.low_energy_swap,
          vegetarian: meal.vegetarian_swap,
          dairy_free: meal.dairy_free_swap,
          gluten_free: meal.gluten_free_swap,
        },
        grocery_items: meal.grocery_items,
        safety_note: meal.safety_note,
      }))
    );
  }

  // 10. Return the saved plan
  return NextResponse.json({ blocked: false, plan: savedPlan });
}
