import "server-only";
import type { z } from "zod";
import { getAiClient, getAiModel } from "./client";
import { AiGenerationError } from "./errors";
import { isAiMockEnabled, mockFromSchema } from "./mock";
import type { AiUsage } from "./usage";

const DEFAULT_TIMEOUT_MS = 60_000;

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
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
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
  temperature = 0.6,
  maxTokens = 4096,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  usageSink,
}: GenerateOptions<S>): Promise<z.infer<S>> {
  const model = getAiModel();
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

  const client = getAiClient();

  let responseText: string;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const message = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        temperature,
        system: `${systemPrompt}\n\nRespond with a single valid JSON object only. No prose, no markdown.`,
        messages: [{ role: "user", content: userPrompt }],
      },
      { timeout: timeoutMs }
    );

    // Provider token truth — the basis for actual cost.
    inputTokens = message.usage?.input_tokens ?? 0;
    outputTokens = message.usage?.output_tokens ?? 0;

    responseText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  } catch (err) {
    const isTimeout =
      err instanceof Error && /timed? ?out/i.test(err.message);
    console.error("[ai] provider call failed", {
      model,
      timeout: isTimeout,
    });
    record(isTimeout ? "timeout" : "provider_error");
    throw new AiGenerationError(
      "AI provider call failed",
      isTimeout ? "timeout" : "provider_error"
    );
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
