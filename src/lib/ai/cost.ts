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

/**
 * Versioned provider pricing (Prompt 11). Prices per 1M tokens, keyed by
 * provider+model+effective date, so a model or price change adds a row rather
 * than editing a constant. `priceFor` picks the newest entry effective on or
 * before the generation date — historical rows keep costing historical prices.
 */
export interface PriceEntry {
  provider: string;
  model: string;
  effective: string; // ISO date the price took effect
  inputPerMTok: number;
  outputPerMTok: number;
}

export const PRICING: PriceEntry[] = [
  {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    effective: "2025-10-01",
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
  },
];

/** Newest price for a model effective at or before `atIso` (default: now). */
export function priceFor(model: string, atIso?: string): PriceEntry | null {
  const at = atIso ? Date.parse(atIso) : Date.now();
  const candidates = PRICING.filter(
    (p) => p.model === model && Date.parse(p.effective) <= at
  ).sort((a, b) => Date.parse(b.effective) - Date.parse(a.effective));
  return candidates[0] ?? null;
}

/**
 * Actual cost from real token counts using versioned pricing. Falls back to the
 * default Haiku rate for an unknown model so cost is never silently zero.
 */
export function computeActualCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  atIso?: string
): number {
  const price = priceFor(model, atIso);
  if (!price) return computeCostUsd(inputTokens, outputTokens);
  return (
    (inputTokens / 1_000_000) * price.inputPerMTok +
    (outputTokens / 1_000_000) * price.outputPerMTok
  );
}

/** Rough per-route token footprints (input+output) for the cost estimate. */
const ROUTE_TOKEN_ESTIMATE: Record<string, { input: number; output: number }> = {
  "daily-plan": { input: 1800, output: 3500 },
  "weekly-plan": { input: 1800, output: 3500 },
  "meal-rhythm": { input: 1200, output: 2500 },
  "habit-plan": { input: 900, output: 1500 },
  "journal-reflection": { input: 700, output: 900 },
  "low-energy-day": { input: 1000, output: 2000 },
  "regenerate-section": { input: 1200, output: 1500 },
  "plan-repair": { input: 2200, output: 3000 },
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
 * runaway cost (bug, abuse, viral spike), NOT a budget. At ~$0.01-0.03 per
 * generation the default still allows hundreds of plans/day. Raise via env as
 * the paying user base grows. Tunable via AI_GLOBAL_DAILY_CEILING_USD.
 */
export function globalDailyCeilingUsd(): number {
  const raw = process.env.AI_GLOBAL_DAILY_CEILING_USD;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}
