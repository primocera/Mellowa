import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LowEnergyDayInput } from "@/schemas/low-energy-day";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateLowEnergyDay } from "@/lib/ai/generate-low-energy-day";
import { AiGenerationError } from "@/lib/ai/errors";
import { guardAiRoute } from "@/lib/ai/guard";
import { recordAiUsage } from "@/lib/ai/rate-limit";
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

  // 3. Validate input
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = LowEnergyDayInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Premium/trial gate + rate limit.
  const guard = await guardAiRoute(user.id, { requirePremium: true });
  if (guard) return guard;

  // 4. Safety check BEFORE any generation
  const freeText = [input.notes, input.must_do_task, input.food_available]
    .filter(Boolean)
    .join("\n");
  const safety = await checkInputSafety(user.id, "low-energy-day", freeText);

  if (safety.should_block_generation) {
    return NextResponse.json(
      { blocked: true, user_message: safety.user_message },
      { status: 200 }
    );
  }

  // 5. Latest check-in for context (optional)
  const today = new Date().toISOString().slice(0, 10);
  const { data: checkin } = await supabase
    .from("daily_checkins")
    .select(
      "energy_level, mood_level, stress_level, sleep_quality, time_available, today_focus"
    )
    .eq("user_id", user.id)
    .eq("checkin_date", today)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 6. Generate
  let plan;
  try {
    plan = await generateLowEnergyDay({
      profile: profile as WellbeingProfile,
      checkin: checkin ?? null,
      availableTime: input.available_time,
      foodAvailable: input.food_available,
      mustDoTask: input.must_do_task,
      notes: input.notes,
    });
  } catch (err) {
    const code = err instanceof AiGenerationError ? err.code : "provider_error";
    return NextResponse.json(
      { error: "Plan generation failed", code },
      { status: 502 }
    );
  }

  // 7. Keep it on today's daily plan as the low-energy backup, if one exists.
  await supabase
    .from("daily_plans")
    .update({ low_energy_backup_plan: plan })
    .eq("user_id", user.id)
    .eq("plan_date", today);

  // 8. Record usage after success only.
  await recordAiUsage(user.id, "low-energy-day");

  return NextResponse.json({ blocked: false, plan });
}
