import "server-only";

/**
 * AI cost estimation (Prompt 16).
 *
 * We record an APPROXIMATE cost per generation into the ledger at claim time so
 * a global daily spend ceiling can be enforced cheaply, without waiting for
 * exact provider token counts. Prices are per 1M tokens for the default model
 * (claude-haiku-4-5). Update if the model or pricing changes.
 */
const HAIKU_INPUT_PER_MTOK = 1.0;
const HAIKU_OUTPUT_PER_MTOK = 5.0;

/** Rough per-route token footprints (input+output) for the cost estimate. */
const ROUTE_TOKEN_ESTIMATE: Record<string, { input: number; output: number }> = {
  "daily-plan": { input: 1800, output: 3500 },
  "weekly-plan": { input: 1800, output: 3500 },
  "meal-rhythm": { input: 1200, output: 2500 },
  "habit-plan": { input: 900, output: 1500 },
  "journal-reflection": { input: 700, output: 900 },
  "low-energy-day": { input: 1000, output: 2000 },
  "regenerate-section": { input: 1200, output: 1500 },
};

const DEFAULT_ESTIMATE = { input: 1500, output: 2500 };

export function computeCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * HAIKU_INPUT_PER_MTOK +
    (outputTokens / 1_000_000) * HAIKU_OUTPUT_PER_MTOK
  );
}

/** Estimated cost of one generation on the given route, in USD. */
export function estimateRouteCostUsd(route: string): number {
  const est = ROUTE_TOKEN_ESTIMATE[route] ?? DEFAULT_ESTIMATE;
  return computeCostUsd(est.input, est.output);
}

/**
 * Global daily spend ceiling across ALL users, in USD. A safety valve against
 * runaway cost (bug, abuse, viral spike). Tunable via env; generous default.
 */
export function globalDailyCeilingUsd(): number {
  const raw = process.env.AI_GLOBAL_DAILY_CEILING_USD;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25;
}
