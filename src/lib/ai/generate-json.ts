import "server-only";
import type { z } from "zod";
import { getAiClient, getAiModel } from "./client";
import { AiGenerationError } from "./errors";

const DEFAULT_TIMEOUT_MS = 60_000;

type GenerateOptions<S extends z.ZodTypeAny> = {
  systemPrompt: string;
  userPrompt: string;
  zodSchema: S;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
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
}: GenerateOptions<S>): Promise<z.infer<S>> {
  const client = getAiClient();

  let responseText: string;
  try {
    const message = await client.messages.create(
      {
        model: getAiModel(),
        max_tokens: maxTokens,
        temperature,
        system: `${systemPrompt}\n\nRespond with a single valid JSON object only. No prose, no markdown.`,
        messages: [{ role: "user", content: userPrompt }],
      },
      { timeout: timeoutMs }
    );

    responseText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  } catch (err) {
    const isTimeout =
      err instanceof Error && /timed? ?out/i.test(err.message);
    console.error("[ai] provider call failed", {
      model: getAiModel(),
      timeout: isTimeout,
    });
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
      model: getAiModel(),
      length: responseText.length,
    });
    throw new AiGenerationError("AI returned invalid JSON", "invalid_json");
  }

  const result = zodSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[ai] schema validation failed", {
      model: getAiModel(),
      issues: result.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`),
    });
    throw new AiGenerationError(
      "AI output failed schema validation",
      "schema_validation_failed"
    );
  }

  return result.data;
}
