/**
 * Per-model request parameters for the Anthropic Messages API.
 *
 * Kept pure (no server-only import) so the arithmetic is unit-testable. The
 * rollback path is the AI_PROVIDER_MODEL env var: everything here must stay
 * valid for claude-haiku-4-5 as well as claude-haiku-5-5.
 */

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

/** Haiku 4.5 ran without thinking; this is the closest Haiku 5.5 equivalent. */
const DEFAULT_HAIKU_5_5_EFFORT: Effort = "low";

/**
 * The TS SDK refuses a non-streaming request whose max_tokens implies more than
 * 10 minutes of generation (60min * max_tokens / 128_000 > 10min, i.e. above
 * ~21_333). Stay below it; anything larger would need streaming.
 */
export const NON_STREAMING_MAX_TOKENS = 21_000;

export function isHaiku55(model: string): boolean {
  return model === "claude-haiku-5-5" || model.startsWith("claude-haiku-5-5-");
}

/**
 * output_config.effort to send, or undefined to send none. Only Haiku 5.5 gets
 * one: Haiku 4.5 rejects the parameter, so a rollback must not carry it.
 * AI_PROVIDER_EFFORT overrides the level; an unknown value falls back to low.
 */
export function effortFor(
  model: string,
  raw: string | undefined = process.env.AI_PROVIDER_EFFORT
): Effort | undefined {
  if (!isHaiku55(model)) return undefined;
  const wanted = raw?.trim().toLowerCase();
  return EFFORT_LEVELS.find((e) => e === wanted) ?? DEFAULT_HAIKU_5_5_EFFORT;
}

/**
 * max_tokens with headroom. Haiku 5.5 counts the same text as ~30% more tokens
 * and its thinking tokens count toward max_tokens, so a route's visible-output
 * budget gets x1.3 + 4000, capped below the SDK's non-streaming limit.
 */
export function withTokenHeadroom(maxTokens: number): number {
  return Math.min(Math.ceil(maxTokens * 1.3) + 4000, NON_STREAMING_MAX_TOKENS);
}
