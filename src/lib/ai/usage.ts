import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeActualCostUsd } from "@/lib/ai/cost";

/**
 * AI usage ledger finalization (Prompt 11). Advances a reserved
 * ai_usage_events row to its real outcome with provider token truth, actual
 * cost, latency and status. NEVER receives or stores raw prompts/responses.
 */

export type AiStatus =
  | "reserved"
  | "success"
  | "fallback"
  | "schema_failed"
  | "invalid_json"
  | "timeout"
  | "provider_error"
  | "quality_failed" // provider returned, but the plan failed quality/allergen gates
  | "safety_blocked"
  | "released"; // reserved but the provider was never called

/** Provider usage captured by generateStructuredJson for one attempt. */
export interface AiUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: AiStatus;
}

export interface FinalizeInput {
  status: AiStatus;
  usage?: AiUsage | null;
  promptVersion?: string | null;
  retryCount?: number;
  fallbackUsed?: boolean;
  resultId?: string | null;
}

/**
 * Finalize the claimed ledger row. Best-effort: ledger accounting must never
 * break a user-facing response, so failures are logged (without content) and
 * swallowed.
 */
export async function finalizeAiUsage(
  eventId: string | null | undefined,
  input: FinalizeInput
): Promise<void> {
  if (!eventId) return;
  try {
    const u = input.usage ?? null;
    const model = u?.model ?? null;
    const inTok = u?.inputTokens ?? 0;
    const outTok = u?.outputTokens ?? 0;
    // Truthful billing: any call that returned tokens was charged by the
    // provider, even if the JSON later failed to parse or validate. A fallback
    // (static plan, provider never returned) costs nothing; a pure
    // timeout/provider_error/released/blocked has no tokens and no cost.
    const hasTokens = inTok + outTok > 0;
    const actualCost = hasTokens
      ? computeActualCostUsd(model ?? "", inTok, outTok)
      : input.status === "fallback"
        ? 0
        : null;

    const admin = createAdminClient();
    await admin.rpc("finalize_ai_usage", {
      p_event_id: eventId,
      p_status: input.status,
      p_provider: u?.provider ?? null,
      p_model: model,
      p_prompt_version: input.promptVersion ?? null,
      p_input_tokens: inTok,
      p_output_tokens: outTok,
      p_actual_cost_usd: actualCost,
      p_latency_ms: u?.latencyMs ?? null,
      p_retry_count: input.retryCount ?? 0,
      p_fallback_used: input.fallbackUsed ?? false,
      p_result_id: input.resultId ?? null,
    });
  } catch (err) {
    console.error("[ai] finalize_ai_usage failed", {
      status: input.status,
      message: err instanceof Error ? err.message : "unknown",
    });
  }
}

/**
 * Sums provider usage across up to N attempts (initial + corrective retries)
 * into one ledger-ready record. Returns undefined when no attempt reached the
 * provider at all.
 */
export function sumUsage(
  usages: (AiUsage | null | undefined)[],
  status: AiStatus
): AiUsage | undefined {
  const real = usages.filter((u): u is AiUsage => u != null);
  if (!real.length) return undefined;
  const last = real[real.length - 1];
  return {
    provider: last.provider,
    model: last.model,
    inputTokens: real.reduce((a, u) => a + u.inputTokens, 0),
    outputTokens: real.reduce((a, u) => a + u.outputTokens, 0),
    latencyMs: real.reduce((a, u) => a + u.latencyMs, 0),
    status,
  };
}

/** Classify a reservation whose provider call never happened. */
export async function releaseReservation(
  eventId: string | null | undefined
): Promise<void> {
  await finalizeAiUsage(eventId, { status: "released" });
}
