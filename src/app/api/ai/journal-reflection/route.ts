import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { JournalInput, type JournalInputType } from "@/schemas/wellbeing";
import { checkInputSafety } from "@/lib/safety/check-input";
import { preClassifySafety } from "@/lib/safety/pre-classify";
import { generateStructuredJson, type UsageSink } from "@/lib/ai/generate-json";
import { AiGenerationError } from "@/lib/ai/errors";
import { JournalReflectionOutput } from "@/schemas/ai-output";
import { getUserSubscriptionStatus } from "@/lib/stripe/subscription";
import { guardAiRoute } from "@/lib/ai/guard";
import { getConsentStatus } from "@/lib/consent/status";
import { JOURNAL_SYSTEM_PROMPT } from "@/prompts/journal";
import { finalizeAiUsage, releaseReservation, sumUsage } from "@/lib/ai/usage";
import { promptVersionId } from "@/prompts/versions";
import { checkJournalReflectionOutput, correctiveInstruction } from "@/lib/ai/output-guards";

// Neutral, non-clinical copy for a reflection that fails the output guard even
// after one corrective retry. We never expose the unsafe draft or the reasons.
const SAFETY_FALLBACK_MESSAGE =
  "We couldn't create a reflection for this entry right now. Your journal has been saved — you can try again whenever you like.";

const PROMPT_VERSION = promptVersionId("journal");

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

async function saveEntry(supabase: SupabaseServer, userId: string, entry: JournalInputType) {
  const { error } = await supabase.from("journal_entries").insert({
    user_id: userId,
    entry_date: new Date().toISOString().slice(0, 10),
    prompt: entry.prompt,
    answer: entry.answer,
    mood_before: entry.mood_before ?? null,
    mood_after: entry.mood_after ?? null,
  });
  return !error;
}

/**
 * Free, deterministic crisis screen (no provider call). When the deterministic
 * pre-classifier matches, we hand the SAME text to checkInputSafety: it re-runs
 * the identical deterministic rule, records the private safety_events row
 * (which drives reminder suppression) and returns before any AI classifier
 * call. When the pre-classifier does not match, checkInputSafety is never
 * called, so no paid classifier call is made.
 */
async function deterministicBlock(userId: string, text: string) {
  if (!preClassifySafety(text.trim())) return null;
  const result = await checkInputSafety(userId, "journal", text);
  return result.should_block_generation
    ? NextResponse.json({ blocked: true, user_message: result.user_message }, { status: 200 })
    : null;
}

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

  // Consent FIRST (GDPR Art. 9): journal text is wellbeing data. Nothing is
  // stored or classified until the current-version required consents are on
  // record. Same checkpoint and response shape as guardAiRoute; an unreadable
  // consent state resolves to "missing", so this fails closed.
  const consent = await getConsentStatus(user.id);
  if (!consent.complete) {
    return NextResponse.json(
      { error: "consent_required", missing: consent.missing },
      { status: 403 }
    );
  }

  // Journaling is free; the AI reflection is a premium feature and costs a
  // provider call. An unverifiable subscription resolves to non-premium, so a
  // billing outage never unlocks a paid call.
  const sub = await getUserSubscriptionStatus(user.id);
  if (!sub.isPremium) {
    // Free tier: deterministic crisis screen only — never the paid classifier.
    const blocked = await deterministicBlock(user.id, entry.answer);
    if (blocked) return blocked;
    if (!(await saveEntry(supabase, user.id, entry))) {
      return NextResponse.json({ error: "Failed to save entry" }, { status: 500 });
    }
    return NextResponse.json({
      blocked: false,
      saved: true,
      reflection: null,
      premium_required: true,
    });
  }

  // Premium: the shared guard (operator per-account switch, consent, rate
  // limit + global ceiling) reserves the reflection call. Premium was verified
  // just above, so the guard does not re-read it.
  const guard = await guardAiRoute(user.id, {
    requirePremium: false,
    route: "journal-reflection",
  });
  if (guard instanceof NextResponse) {
    // Consent can only be missing here if it changed mid-request — nothing is
    // stored. Any other denial keeps today's graceful behaviour: the entry is
    // still saved (after the free deterministic screen), just without an AI
    // reflection.
    if (guard.status === 403) {
      const denial = (await guard.clone().json().catch(() => null)) as { error?: string } | null;
      if (denial?.error === "consent_required") return guard;
    }
    const blocked = await deterministicBlock(user.id, entry.answer);
    if (blocked) return blocked;
    if (!(await saveEntry(supabase, user.id, entry))) {
      return NextResponse.json({ error: "Failed to save entry" }, { status: 500 });
    }
    return NextResponse.json({
      blocked: false,
      saved: true,
      reflection: null,
      rate_limited: guard.status === 429,
      capacity: guard.status === 503,
      generation_unavailable: guard.status === 403,
    });
  }
  const eventId = guard.eventId;

  // Safety first — journal text is free-form. Full classification BEFORE the
  // entry is saved or a reflection is generated.
  const safety = await checkInputSafety(user.id, "journal", entry.answer);
  if (safety.should_block_generation) {
    await finalizeAiUsage(eventId, { status: "safety_blocked", promptVersion: PROMPT_VERSION });
    return NextResponse.json(
      { blocked: true, user_message: safety.user_message },
      { status: 200 }
    );
  }

  if (!(await saveEntry(supabase, user.id, entry))) {
    // Reservation made but the provider was never reached — release it.
    await releaseReservation(eventId);
    return NextResponse.json({ error: "Failed to save entry" }, { status: 500 });
  }

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
