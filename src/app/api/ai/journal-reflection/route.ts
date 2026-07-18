import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { JournalInput } from "@/schemas/wellbeing";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateStructuredJson, type UsageSink } from "@/lib/ai/generate-json";
import { AiGenerationError } from "@/lib/ai/errors";
import { JournalReflectionOutput } from "@/schemas/ai-output";
import { getUserSubscriptionStatus } from "@/lib/stripe/subscription";
import { claimAiGeneration } from "@/lib/ai/rate-limit";
import { JOURNAL_SYSTEM_PROMPT } from "@/prompts/journal";
import { finalizeAiUsage, sumUsage } from "@/lib/ai/usage";
import { promptVersionId } from "@/prompts/versions";
import { checkJournalReflectionOutput, correctiveInstruction } from "@/lib/ai/output-guards";

const PROMPT_VERSION = promptVersionId("journal");

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

  const parsed = JournalInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const entry = parsed.data;

  // Safety first — journal text is free-form
  const safety = await checkInputSafety(user.id, "journal", entry.answer);
  if (safety.should_block_generation) {
    return NextResponse.json(
      { blocked: true, user_message: safety.user_message },
      { status: 200 }
    );
  }

  // Save the entry
  const { error: saveError } = await supabase.from("journal_entries").insert({
    user_id: user.id,
    entry_date: new Date().toISOString().slice(0, 10),
    prompt: entry.prompt,
    answer: entry.answer,
    mood_before: entry.mood_before ?? null,
    mood_after: entry.mood_after ?? null,
  });

  if (saveError) {
    return NextResponse.json({ error: "Failed to save entry" }, { status: 500 });
  }

  // Journaling is free; the AI reflection is a premium feature and costs a
  // provider call — gate it (gracefully) so the entry is still saved.
  const sub = await getUserSubscriptionStatus(user.id);
  if (!sub.isPremium) {
    return NextResponse.json({
      blocked: false,
      saved: true,
      reflection: null,
      premium_required: true,
    });
  }
  // Atomically reserve the reflection call (rate limit + global ceiling).
  const claim = await claimAiGeneration(user.id, "journal-reflection");
  if (!claim.ok) {
    return NextResponse.json({
      blocked: false,
      saved: true,
      reflection: null,
      rate_limited: claim.scope !== "capacity",
      capacity: claim.scope === "capacity",
    });
  }

  // Gentle reflection
  let reflection;
  try {
    reflection = await generateStructuredJson({
      systemPrompt: JOURNAL_SYSTEM_PROMPT,
      userPrompt: `Journal prompt: ${entry.prompt || "free writing"}\n\nUser's entry:\n"""${entry.answer}"""`,
      zodSchema: JournalReflectionOutput,
      temperature: 0.7,
      maxTokens: 1024,
    });
  } catch (err) {
    // Entry is already saved — reflection is best-effort
    const code = err instanceof AiGenerationError ? err.code : "provider_error";
    return NextResponse.json({ blocked: false, saved: true, reflection: null, code });
  }

  return NextResponse.json({ blocked: false, saved: true, reflection });
}
