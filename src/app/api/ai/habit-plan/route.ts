import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateStructuredJson, type UsageSink } from "@/lib/ai/generate-json";
import { AiGenerationError } from "@/lib/ai/errors";
import { HABIT_PLAN_SYSTEM_PROMPT } from "@/prompts/habits";
import { HabitPlanOutput } from "@/schemas/ai-output";
import { guardAiRoute } from "@/lib/ai/guard";
import { finalizeAiUsage, releaseReservation, sumUsage } from "@/lib/ai/usage";
import { promptVersionId } from "@/prompts/versions";
import { checkHabitPlanOutput, correctiveInstruction } from "@/lib/ai/output-guards";

const PROMPT_VERSION = promptVersionId("habit-plan");

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Premium-only + rate limit — protects the AI provider key.
  const guard = await guardAiRoute(user.id, { requirePremium: true, route: "habit-plan" });
  if (guard instanceof NextResponse) return guard;
  const eventId = guard.eventId;

  const [profileRes, checkinsRes, habitsRes] = await Promise.all([
    supabase
      .from("wellbeing_profiles")
      .select("primary_goal, work_schedule, movement_level, preferred_tone, wake_time, sleep_time")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("daily_checkins")
      .select("checkin_date, energy_level, mood_level, stress_level, sleep_quality")
      .eq("user_id", user.id)
      .order("checkin_date", { ascending: false })
      .limit(7),
    supabase
      .from("habits")
      .select("name")
      .eq("user_id", user.id)
      .eq("active", true),
  ]);

  if (!profileRes.data) {
    await releaseReservation(eventId);
    return NextResponse.json({ error: "onboarding_required" }, { status: 400 });
  }

  const existing = (habitsRes.data ?? []).map((h) => h.name);
  const userPrompt = `User profile:
${JSON.stringify(profileRes.data, null, 2)}

Recent check-ins:
${JSON.stringify(checkinsRes.data ?? [], null, 2)}

Existing active habits (do not repeat these): ${existing.join(", ") || "none"}

Suggest 1-3 small new habits as structured JSON.`;

  const sink1: UsageSink = {};
  const sink2: UsageSink = {};
  let retried = false;
  let plan;
  try {
    plan = await generateStructuredJson({
      route: "habit-plan",
      systemPrompt: HABIT_PLAN_SYSTEM_PROMPT,
      userPrompt,
      zodSchema: HabitPlanOutput,
      temperature: 0.7,
      maxTokens: 2048,
      usageSink: sink1,
    });

    // Output quality gate (Prompt 13): one corrective retry, then fail closed.
    let quality = checkHabitPlanOutput(plan);
    if (!quality.ok) {
      retried = true;
      plan = await generateStructuredJson({
      route: "habit-plan",
        systemPrompt: HABIT_PLAN_SYSTEM_PROMPT,
        userPrompt: `${userPrompt}\n\nIMPORTANT CORRECTION: ${correctiveInstruction(quality.reasons)}`,
        zodSchema: HabitPlanOutput,
        temperature: 0.5,
        maxTokens: 2048,
        usageSink: sink2,
      });
      quality = checkHabitPlanOutput(plan);
      if (!quality.ok) {
        await finalizeAiUsage(eventId, {
          status: "quality_failed",
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
      { error: "Habit suggestion failed", code },
      { status: 502 }
    );
  }

  await finalizeAiUsage(eventId, {
    status: "success",
    promptVersion: PROMPT_VERSION,
    usage: sumUsage([sink1.usage, sink2.usage], "success"),
    retryCount: retried ? 1 : 0,
  });
  return NextResponse.json({ suggestions: plan });
}
