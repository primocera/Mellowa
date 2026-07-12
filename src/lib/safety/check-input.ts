import "server-only";
import { generateStructuredJson } from "@/lib/ai/generate-json";
import { SAFETY_SYSTEM_PROMPT } from "@/prompts/safety";
import { SafetyCheckOutput, type SafetyCheckOutputType } from "@/schemas/safety";
import { createAdminClient } from "@/lib/supabase/admin";

const SAFE_RESULT: SafetyCheckOutputType = {
  is_safe: true,
  risk_level: "none",
  risk_types: [],
  should_block_generation: false,
  user_message: "",
  internal_reason: "empty input",
};

const BLOCKED_FALLBACK: SafetyCheckOutputType = {
  is_safe: false,
  risk_level: "medium",
  risk_types: ["other"],
  should_block_generation: true,
  user_message:
    "We couldn't safely process this right now. If you're going through something urgent or health-related, please reach out to a qualified professional or local emergency services.",
  internal_reason: "safety classifier unavailable — failing closed",
};

/**
 * Classifies user text before any plan generation.
 * Fails CLOSED: if the classifier errors, generation is blocked.
 */
export async function checkInputSafety(
  userId: string,
  source: string,
  text: string
): Promise<SafetyCheckOutputType> {
  const trimmed = text.trim();
  if (!trimmed) return SAFE_RESULT;

  let result: SafetyCheckOutputType;
  try {
    result = await generateStructuredJson({
      systemPrompt: SAFETY_SYSTEM_PROMPT,
      userPrompt: `Source: ${source}\n\nUser input:\n"""${trimmed.slice(0, 4000)}"""`,
      zodSchema: SafetyCheckOutput,
      temperature: 0,
      maxTokens: 1024,
    });
  } catch {
    result = BLOCKED_FALLBACK;
  }

  if (result.should_block_generation) {
    await logSafetyEvent(userId, source, result, trimmed);
  }

  return result;
}

/** Stores a private safety event. Only a short excerpt — never full text. */
async function logSafetyEvent(
  userId: string,
  source: string,
  result: SafetyCheckOutputType,
  text: string
) {
  try {
    const admin = createAdminClient();
    await admin.from("safety_events").insert({
      user_id: userId,
      source,
      risk_type: result.risk_types.join(",") || "other",
      risk_level: result.risk_level,
      user_input_excerpt: text.slice(0, 120),
      action_taken: "blocked_generation",
    });
  } catch (err) {
    console.error("[safety] failed to log safety event", {
      source,
      risk_level: result.risk_level,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}
