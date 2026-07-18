import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LowEnergyDayInput } from "@/schemas/low-energy-day";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateLowEnergyDay } from "@/lib/ai/generate-low-energy-day";
import { AiGenerationError } from "@/lib/ai/errors";
import { guardAiRoute } from "@/lib/ai/guard";
import type { UsageSink } from "@/lib/ai/generate-json";
import { finalizeAiUsage, sumUsage } from "@/lib/ai/usage";
import { promptVersionId } from "@/prompts/versions";
import { checkLowEnergyDayOutput, correctiveInstruction } from "@/lib/ai/output-guards";
import { allergenExclusionInstruction } from "@/lib/safety/allergens";
import { severeAllergyBlock } from "@/lib/safety/severe-allergy";
import type { WellbeingProfile } from "@/types/dailyflow";

const PROMPT_VERSION = promptVersionId("low-energy-day");

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

  // Severe allergies: no specific meal generation (Prompt 8).
  const severeBlock = severeAllergyBlock(profile);
  if (severeBlock) return NextResponse.json(severeBlock, { status: 200 });

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
  const guard = await guardAiRoute(user.id, { requirePremium: true, route: "low-energy-day" });
  if (guard instanceof NextResponse) return guard;
  const eventId = guard.eventId;

  // 4. Safety check BEFORE any generation
  const freeText = [input.notes, input.must_do_task, input.food_available]
    .filter(Boolean)
    .join("\n");
  const safety = await checkInputSafety(user.id, "low-energy-day", freeText);

  if (safety.should_block_generation) {
    await finalizeAiUsage(eventId, { status: "safety_blocked", promptVersion: PROMPT_VERSION });
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

  // 6. Generate, then validate the output (Prompt 13): banned language +
  // deterministic allergen scan; one corrective retry, then fail closed.
  const genArgs = {
    profile: profile as WellbeingProfile,
    checkin: checkin ?? null,
    availableTime: input.available_time,
    foodAvailable: input.food_available,
    mustDoTask: input.must_do_task,
    notes: input.notes,
  };
  const allergies = ((profile.allergies as string[] | null) ?? []).filter(Boolean);
  const sink1: UsageSink = {};
  const sink2: UsageSink = {};
  let retried = false;
  let plan;
  try {
    plan = await generateLowEnergyDay({ ...genArgs, usageSink: sink1 });
    let quality = checkLowEnergyDayOutput(plan, allergies);
    if (!quality.ok) {
      retried = true;
      const hadAllergen = quality.reasons.some((r) => r.startsWith("allergen:"));
      plan = await generateLowEnergyDay({
        ...genArgs,
        usageSink: sink2,
        extraInstruction: `${correctiveInstruction(quality.reasons)}${
          hadAllergen ? `

${allergenExclusionInstruction(allergies)}` : ""
        }`,
      });
      quality = checkLowEnergyDayOutput(plan, allergies);
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

  await finalizeAiUsage(eventId, {
    status: "success",
    promptVersion: PROMPT_VERSION,
    usage: sumUsage([sink1.usage, sink2.usage], "success"),
    retryCount: retried ? 1 : 0,
  });
  return NextResponse.json({ blocked: false, plan });
}
