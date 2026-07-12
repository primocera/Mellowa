import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DailyCheckinInput } from "@/schemas/wellbeing";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateDailyPlan } from "@/lib/ai/generate-daily-plan";
import { AiGenerationError } from "@/lib/ai/errors";
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

  // 4. Safety check BEFORE any generation
  const freeText = [checkin.today_focus, checkin.notes, checkin.hunger_pattern]
    .filter(Boolean)
    .join("\n");
  const safety = await checkInputSafety(user.id, "daily-plan", freeText);

  // 5. Blocked → return safety message, no plan
  if (safety.should_block_generation) {
    return NextResponse.json(
      { blocked: true, user_message: safety.user_message },
      { status: 200 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);

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

  let plan;
  try {
    plan = await generateDailyPlan({
      profile: profile as WellbeingProfile,
      checkin,
      habits: (habitRows ?? []).map((h) => h.name),
      date: today,
    });
  } catch (err) {
    const code = err instanceof AiGenerationError ? err.code : "provider_error";
    return NextResponse.json(
      { error: "Plan generation failed", code },
      { status: 502 }
    );
  }

  // 8. Save the plan
  const { data: savedPlan, error: planError } = await supabase
    .from("daily_plans")
    .insert({
      user_id: user.id,
      checkin_id: savedCheckin.id,
      plan_date: today,
      plan_summary: plan.plan_summary,
      morning_routine: plan.morning_routine,
      meal_rhythm: plan.meal_rhythm,
      hydration_plan: plan.hydration_plan,
      movement_plan: plan.movement_plan,
      stress_reset: plan.stress_reset,
      focus_plan: plan.focus_plan,
      evening_routine: plan.evening_routine,
      habit_focus: plan.habit_focus,
      encouragement: plan.encouragement,
      safety_note: plan.safety_note,
    })
    .select()
    .single();

  if (planError) {
    return NextResponse.json({ error: "Failed to save plan" }, { status: 500 });
  }

  // 9. Return the saved plan
  return NextResponse.json({ blocked: false, plan: savedPlan });
}
