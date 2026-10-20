import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { getAiClient, getAiModel } from "./client";
import { AiGenerationError } from "./errors";
import { isAiMockEnabled, mockFromSchema } from "./mock";
import type { AiUsage } from "./usage";
import { CircuitBreaker } from "./circuit-breaker";
import { isKilled, policyFor, type AiRouteName } from "./model-policy";
import { effortFor, withTokenHeadroom } from "./model-params";

// Instance-local breaker (best-effort on serverless — see circuit-breaker.ts).
const providerBreaker = new CircuitBreaker({ threshold: 5, openMs: 60_000 });

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Anthropic.APIConnectionTimeoutError ||
    (err instanceof Error && /timed? ?out/i.test(err.message))
  );
}

/**
 * Retryable provider failures: timeouts and other connection errors, request
 * timeout/conflict, rate limit and 5xx/overload — the set the SDK would retry
 * on its own. The SDK's internal retries are switched off (maxRetries: 0), so
 * this single deadline-aware retry is the only one.
 */
function isRetryableProviderError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError || isTimeoutError(err)) return true;
  const status = (err as { status?: number } | null)?.status;
  if (typeof status !== "number") return false;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

const DEFAULT_TIMEOUT_MS = 60_000;

// Minimum remaining budget worth spending on a rate-limit/overload retry. If a
// caller-supplied `deadline` leaves less than this, we fail closed instead of
// starting an attempt that cannot finish before the deadline.
const MIN_RETRY_BUDGET_MS = 2_000;

/**
 * Mutable sink for provider usage (Prompt 11). The caller passes an object; this
 * function writes the attempt's tokens/latency/model/outcome into `.usage` on
 * both success and failure, so the route can finalize the ledger row. Kept out
 * of the return type so existing callers are unaffected.
 */
export type UsageSink = { usage?: AiUsage };

type GenerateOptions<S extends z.ZodTypeAny> = {
  systemPrompt: string;
  userPrompt: string;
  zodSchema: S;
  /** Route name — applies the model policy defaults + kill switch (Prompt 14). */
  route?: AiRouteName;
  /** Visible-output budget; tokenizer/thinking headroom is added on top. */
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Absolute wall-clock deadline (epoch ms) that bounds the TOTAL provider time
   * for this call, including the rate-limit/overload retry and its jitter. When
   * a caller shares one deadline across several generation calls in a single
   * request (e.g. the daily-plan quality/allergen regenerations), it guarantees
   * every provider call collectively finishes before the deadline — so an
   * atomic (user, day) claim lease cannot expire while the original request is
   * still legitimately awaiting the provider. Omitted → only the per-attempt
   * timeout applies (unchanged behaviour for every other route).
   */
  deadline?: number;
  usageSink?: UsageSink;
};

/** Strip markdown fences if the model wrapped the JSON. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * Calls the AI provider and returns a Zod-validated object.
 * Logs only safe metadata on failure — never full user input.
 */
export async function generateStructuredJson<S extends z.ZodTypeAny>({
  systemPrompt,
  userPrompt,
  zodSchema,
  route,
  maxTokens,
  timeoutMs,
  deadline,
  usageSink,
}: GenerateOptions<S>): Promise<z.infer<S>> {
  const policy = route ? policyFor(route) : null;
  const model = policy?.model ?? getAiModel();
  const tokens = withTokenHeadroom(maxTokens ?? policy?.maxTokens ?? 4096);
  const effort = effortFor(model);
  const timeout = timeoutMs ?? policy?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  /** Effective per-attempt timeout, capped by any remaining deadline budget. */
  const attemptTimeout = () =>
    deadline == null ? timeout : Math.min(timeout, deadline - Date.now());
  const started = Date.now();
  const record = (
    status: AiUsage["status"],
    inputTokens = 0,
    outputTokens = 0
  ) => {
    if (usageSink) {
      usageSink.usage = {
        provider: "anthropic",
        model,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - started,
        status,
      };
    }
  };

  // Local dev mock — no provider call, no cost. See lib/ai/mock.ts.
  if (isAiMockEnabled()) {
    console.warn("[ai] AI_MOCK=1 — returning mock data, no provider call");
    await new Promise((r) => setTimeout(r, 400));
    record("success");
    return mockFromSchema(zodSchema);
  }

  // Kill switch by route/model (audited, env-controlled) — before any call.
  if (isKilled({ route, model })) {
    console.warn("[ai] kill switch tripped", { route, model });
    record("provider_error");
    throw new AiGenerationError("AI generation is disabled", "disabled");
  }

  // Circuit breaker: a warm instance stops hammering a failing provider.
  if (providerBreaker.isOpen()) {
    console.warn("[ai] circuit open — skipping provider call", { route, model });
    record("provider_error");
    throw new AiGenerationError("AI provider circuit open", "circuit_open");
  }

  const client = getAiClient();

  // A caller-supplied deadline may already be spent (e.g. earlier regenerations
  // in the same request used the shared budget). Fail closed BEFORE the provider
  // try/catch — otherwise this deliberate timeout would be rewritten as a
  // generic provider error.
  const firstTimeout = attemptTimeout();
  if (deadline != null && firstTimeout <= 0) {
    record("timeout");
    throw new AiGenerationError("AI provider deadline exceeded", "timeout");
  }

  let responseText: string;
  let stopReason: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    // No temperature/top_p/top_k (Haiku 5.5 rejects them) and no prefill.
    const request = (perCallTimeout: number) =>
      client.messages.create(
        {
          model,
          max_tokens: tokens,
          ...(effort ? { output_config: { effort } } : {}),
          system: `${systemPrompt}\n\nRespond with a single valid JSON object only. No prose, no markdown.`,
          messages: [{ role: "user", content: userPrompt }],
        },
        // maxRetries: 0 — the SDK would otherwise retry a timeout twice more,
        // each with the full per-attempt timeout, past any caller deadline.
        { timeout: perCallTimeout, maxRetries: 0 }
      );

    // Bounded retry: exactly one, only for retryable failures, with jitter
    // (backpressure, never a request storm). Under a deadline the jitter and the
    // second attempt are clamped to the remaining budget, and the retry is
    // skipped entirely when too little budget remains.
    let message;
    try {
      message = await request(firstTimeout);
    } catch (err) {
      if (!isRetryableProviderError(err)) throw err;
      const remaining = deadline == null ? timeout : deadline - Date.now();
      const jitter =
        deadline == null
          ? 500 + Math.random() * 1000
          : Math.min(500 + Math.random() * 1000, Math.max(0, remaining - MIN_RETRY_BUDGET_MS));
      if (deadline != null && remaining - jitter < MIN_RETRY_BUDGET_MS) throw err;
      await new Promise((r) => setTimeout(r, jitter));
      const secondTimeout = attemptTimeout();
      if (deadline != null && secondTimeout <= 0) throw err;
      message = await request(secondTimeout);
    }

    // Provider token truth — the basis for actual cost.
    inputTokens = message.usage?.input_tokens ?? 0;
    outputTokens = message.usage?.output_tokens ?? 0;
    stopReason = message.stop_reason ?? null;

    // Thinking blocks may come first; only text blocks carry the answer.
    responseText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  } catch (err) {
    const isTimeout = isTimeoutError(err);
    console.error("[ai] provider call failed", {
      model,
      timeout: isTimeout,
    });
    providerBreaker.recordFailure();
    record(isTimeout ? "timeout" : "provider_error");
    throw new AiGenerationError(
      "AI provider call failed",
      isTimeout ? "timeout" : "provider_error"
    );
  }

  // The provider answered, so this is a breaker success even when the answer
  // is a refusal or was cut off.
  providerBreaker.recordSuccess();

  if (stopReason === "refusal") {
    console.error("[ai] provider declined the request", { model, route });
    record("refusal", inputTokens, outputTokens);
    throw new AiGenerationError("AI provider declined the request", "refusal");
  }
  if (stopReason === "max_tokens") {
    console.error("[ai] response hit max_tokens", { model, route, maxTokens: tokens });
    record("truncated", inputTokens, outputTokens);
    throw new AiGenerationError("AI response was cut off at max_tokens", "truncated");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(responseText));
  } catch {
    console.error("[ai] response was not valid JSON", {
      model,
      length: responseText.length,
    });
    // The provider was called and billed even though parsing failed.
    record("invalid_json", inputTokens, outputTokens);
    throw new AiGenerationError("AI returned invalid JSON", "invalid_json");
  }

  const result = zodSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[ai] schema validation failed", {
      model,
      issues: result.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`),
    });
    record("schema_failed", inputTokens, outputTokens);
    throw new AiGenerationError(
      "AI output failed schema validation",
      "schema_validation_failed"
    );
  }

  record("success", inputTokens, outputTokens);
  return result.data;
}
