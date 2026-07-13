import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateStructuredJson } from "@/lib/ai/generate-json";
import { AiGenerationError } from "@/lib/ai/errors";
import { HABIT_PLAN_SYSTEM_PROMPT } from "@/prompts/habits";
import { HabitPlanOutput } from "@/schemas/ai-output";
import { guardAiRoute } from "@/lib/ai/guard";
import { recordAiUsage } from "@/lib/ai/rate-limit";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Premium-only + rate limit — protects the AI provider key.
  const guard = await guardAiRoute(user.id, { requirePremium: true });
  if (guard) return guard;

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
    return NextResponse.json({ error: "onboarding_required" }, { status: 400 });
  }

  const existing = (habitsRes.data ?? []).map((h) => h.name);

  let plan;
  try {
    plan = await generateStructuredJson({
      systemPrompt: HABIT_PLAN_SYSTEM_PROMPT,
      userPrompt: `User profile:
${JSON.stringify(profileRes.data, null, 2)}

Recent check-ins:
${JSON.stringify(checkinsRes.data ?? [], null, 2)}

Existing active habits (do not repeat these): ${existing.join(", ") || "none"}

Suggest 1-3 small new habits as structured JSON.`,
      zodSchema: HabitPlanOutput,
      temperature: 0.7,
      maxTokens: 2048,
    });
  } catch (err) {
    const code = err instanceof AiGenerationError ? err.code : "provider_error";
    return NextResponse.json(
      { error: "Habit suggestion failed", code },
      { status: 502 }
    );
  }

  await recordAiUsage(user.id, "habit-plan");

  return NextResponse.json({ suggestions: plan });
}
