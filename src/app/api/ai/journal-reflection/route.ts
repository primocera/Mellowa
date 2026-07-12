import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { JournalInput } from "@/schemas/wellbeing";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateStructuredJson } from "@/lib/ai/generate-json";
import { AiGenerationError } from "@/lib/ai/errors";
import { JournalReflectionOutput } from "@/schemas/ai-output";

const JOURNAL_SYSTEM_PROMPT = `You are a gentle reflection companion for a consumer wellness app.
You respond to short journal entries about routines, energy, meals and habits.
You are NOT a therapist. Do not analyze trauma, diagnose emotional states, or give therapy instructions.
Reflect back what the user noticed, ask one gentle question, and suggest one small doable action related to daily routine.

Return structured JSON only:
{
  "reflection": string,   // 1-3 warm sentences reflecting what they shared
  "gentle_question": string,  // one open, non-clinical question
  "one_small_action": string  // one tiny routine-related action
}`;

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
