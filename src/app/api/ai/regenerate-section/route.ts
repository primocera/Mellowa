import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateStructuredJson } from "@/lib/ai/generate-json";
import { AiGenerationError } from "@/lib/ai/errors";
import { DAILY_PLAN_SYSTEM_PROMPT } from "@/prompts/daily-plan";

const REGENERATABLE_SECTIONS = [
  "meal_rhythm",
  "movement_plan",
  "stress_reset",
  "evening_routine",
] as const;

type SectionName = (typeof REGENERATABLE_SECTIONS)[number];

const PlanItem = z.object({
  title: z.string(),
  description: z.string().default(""),
  time_hint: z.string().default(""),
});

const PlanSection = z.object({
  title: z.string(),
  items: z.array(PlanItem).min(1).max(6),
});

const RegenerateInput = z.object({
  plan_id: z.string().uuid(),
  section_name: z.enum(REGENERATABLE_SECTIONS),
  reason: z.enum([
    "simplify",
    "different_meals",
    "less_time",
    "lower_energy",
    "more_structure",
    "custom",
  ]),
  user_note: z.string().max(1000).optional().default(""),
});

const REASON_INSTRUCTIONS: Record<string, string> = {
  simplify: "Make this section simpler and lighter. Fewer steps, easier options.",
  different_meals: "Suggest different meal ideas with similar effort and budget.",
  less_time: "The user has less time than planned. Make it shorter and easier.",
  lower_energy: "The user's energy is lower than expected. Make it gentler.",
  more_structure: "Add a bit more concrete structure and timing.",
  custom: "Follow the user's note below.",
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  const { plan_id, section_name, reason, user_note } = parsed.data;

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
    .select("primary_goal, cooking_time, budget_level, movement_level, food_preferences, allergies, preferred_tone")
    .eq("user_id", user.id)
    .maybeSingle();

  const sectionKey = section_name as SectionName;
  const userPrompt = `The user has an existing daily plan and wants ONE section adjusted.

Section to regenerate: ${section_name}
Reason: ${REASON_INSTRUCTIONS[reason]}
${user_note ? `User note: """${user_note}"""` : ""}

User profile:
${JSON.stringify(profile ?? {}, null, 2)}

Current section content:
${JSON.stringify(plan[sectionKey], null, 2)}

Full plan summary for context:
${JSON.stringify(plan.plan_summary, null, 2)}

Return ONLY the regenerated section as JSON: { "title": string, "items": [{ "title": string, "description": string, "time_hint": string }] }
Keep it consistent with the rest of the plan. 1-6 short, doable items.`;

  let newSection;
  try {
    newSection = await generateStructuredJson({
      systemPrompt: DAILY_PLAN_SYSTEM_PROMPT,
      userPrompt,
      zodSchema: PlanSection,
      temperature: 0.7,
      maxTokens: 2048,
    });
  } catch (err) {
    const code = err instanceof AiGenerationError ? err.code : "provider_error";
    return NextResponse.json(
      { error: "Regeneration failed", code },
      { status: 502 }
    );
  }

  const { error: updateError } = await supabase
    .from("daily_plans")
    .update({ [sectionKey]: newSection })
    .eq("id", plan_id)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to save section" }, { status: 500 });
  }

  return NextResponse.json({ blocked: false, section: newSection });
}
