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
import { finalizeAiUsage, releaseReservation, sumUsage } from "@/lib/ai/usage";
import { promptVersionId } from "@/prompts/versions";
import { checkJournalReflectionOutput, correctiveInstruction } from "@/lib/ai/output-guards";

// Neutral, non-clinical copy for a reflection that fails the output guard even
// after one corrective retry. We never expose the unsafe draft or the reasons.
const SAFETY_FALLBACK_MESSAGE =
  "We couldn't create a reflection for this entry right now. Your journal has been saved — you can try again whenever you like.";

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

  const eventId = claim.eventId;

  // Gentle reflection. Journal text is free-form, so the generated output must
  // pass the journal-specific safety guard (banned clinical/diagnostic/crisis
  // language) — Zod validation alone does not catch that. One corrective retry,
  // then fail closed. Every terminal path finalizes exactly one ledger row.
  const userPrompt = `Journal prompt: ${entry.prompt || "free writing"}\n\nUser's entry:\n"""${entry.answer}"""`;
  const sink1: UsageSink = {};
  const sink2: UsageSink = {};
  let retried = false;
  let reflection;
  try {
    reflection = await generateStructuredJson({
      route: "journal-reflection",
      systemPrompt: JOURNAL_SYSTEM_PROMPT,
      userPrompt,
      zodSchema: JournalReflectionOutput,
      temperature: 0.7,
      maxTokens: 1024,
      usageSink: sink1,
    });

    // Output safety gate: one corrective retry, then fail closed.
    let quality = checkJournalReflectionOutput(reflection);
    if (!quality.ok) {
      retried = true;
      reflection = await generateStructuredJson({
        route: "journal-reflection",
        systemPrompt: JOURNAL_SYSTEM_PROMPT,
        userPrompt: `${userPrompt}\n\nIMPORTANT CORRECTION: ${correctiveInstruction(quality.reasons)}`,
        zodSchema: JournalReflectionOutput,
        temperature: 0.5,
        maxTokens: 1024,
        usageSink: sink2,
      });
      quality = checkJournalReflectionOutput(reflection);
      if (!quality.ok) {
        // Second attempt still unsafe — never persist or return it.
        await finalizeAiUsage(eventId, {
          status: "safety_blocked",
          promptVersion: PROMPT_VERSION,
          usage: sumUsage([sink1.usage, sink2.usage], "safety_blocked"),
          retryCount: 1,
        });
        return NextResponse.json({
          blocked: false,
          saved: true,
          reflection: null,
          reflection_unavailable: true,
          user_message: SAFETY_FALLBACK_MESSAGE,
        });
      }
    }
  } catch (err) {
    // Entry is already saved — reflection is best-effort. Finalize the reserved
    // row with the real provider outcome so it never lingers as reserved.
    const code = err instanceof AiGenerationError ? err.code : "provider_error";
    const anyProviderCall = sink1.usage != null || sink2.usage != null;
    if (anyProviderCall) {
      const failStatus = sink2.usage?.status ?? sink1.usage?.status ?? "provider_error";
      await finalizeAiUsage(eventId, {
        status: failStatus,
        promptVersion: PROMPT_VERSION,
        usage: sumUsage([sink1.usage, sink2.usage], failStatus),
        retryCount: retried ? 1 : 0,
      });
    } else {
      // Reservation made but the provider was never reached — release it.
      await releaseReservation(eventId);
    }
    return NextResponse.json({ blocked: false, saved: true, reflection: null, code });
  }

  await finalizeAiUsage(eventId, {
    status: "success",
    promptVersion: PROMPT_VERSION,
    usage: sumUsage([sink1.usage, sink2.usage], "success"),
    retryCount: retried ? 1 : 0,
  });
  return NextResponse.json({ blocked: false, saved: true, reflection });
}
