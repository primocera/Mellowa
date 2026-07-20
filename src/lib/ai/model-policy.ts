import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * Provider-neutral model policy per AI route (Launch v6, Prompt 14).
 *
 * One place decides model, sampling, token/timeout limits and budgets so a
 * model change is a policy edit (visible in the ledger via model +
 * prompt_version), not a scattered constant hunt. All routes currently use the
 * single configured model; a cheaper model for low-complexity tasks may only
 * be introduced with eval evidence (docs/prompt-versioning.md).
 */

export type AiRouteName =
  | "daily-plan"
  | "weekly-plan"
  | "meal-rhythm"
  | "habit-plan"
  | "low-energy-day"
  | "journal-reflection"
  | "regenerate-section"
  | "plan-repair"
  | "safety-check";

export interface ModelPolicy {
  /** Model id; null = the configured default (serverEnv.aiModel). */
  model: string | null;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  /** Reservation/latency budgets — alerting reference, not a hard stop. */
  costBudgetUsdPerCall: number;
  latencyBudgetMs: number;
  /** What degradation looks like when the provider is unavailable. */
  degradation: "curated_fallback" | "fail_closed" | "skip_optional";
}

const DEFAULT_TIMEOUT_MS = 60_000;

export const MODEL_POLICIES: Record<AiRouteName, ModelPolicy> = {
  "daily-plan": {
    model: null,
    temperature: 0.6,
    maxTokens: 8192,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    costBudgetUsdPerCall: 0.03,
    latencyBudgetMs: 45_000,
    degradation: "curated_fallback", // labeled static plan, allergen-safe
  },
  "weekly-plan": {
    model: null,
    temperature: 0.6,
    maxTokens: 8192,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    costBudgetUsdPerCall: 0.04,
    latencyBudgetMs: 50_000,
    degradation: "fail_closed",
  },
  "meal-rhythm": {
    model: null,
    temperature: 0.7,
    maxTokens: 4096,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    costBudgetUsdPerCall: 0.02,
    latencyBudgetMs: 30_000,
    degradation: "fail_closed",
  },
  "habit-plan": {
    model: null,
    temperature: 0.7,
    maxTokens: 2048,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    costBudgetUsdPerCall: 0.01,
    latencyBudgetMs: 20_000,
    degradation: "fail_closed",
  },
  "low-energy-day": {
    model: null,
    temperature: 0.6,
    maxTokens: 4096,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    costBudgetUsdPerCall: 0.02,
    latencyBudgetMs: 30_000,
    degradation: "fail_closed",
  },
  "journal-reflection": {
    model: null,
    temperature: 0.7,
    maxTokens: 1024,
    timeoutMs: 30_000,
    costBudgetUsdPerCall: 0.005,
    latencyBudgetMs: 15_000,
    degradation: "skip_optional", // entry saved, reflection withheld
  },
  "regenerate-section": {
    model: null,
    temperature: 0.7,
    maxTokens: 3072,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    costBudgetUsdPerCall: 0.015,
    latencyBudgetMs: 25_000,
    // Non-meal sections are served from the curated library without AI.
    degradation: "curated_fallback",
  },
  "plan-repair": {
    model: null,
    temperature: 0.6,
    maxTokens: 4096,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    costBudgetUsdPerCall: 0.025,
    latencyBudgetMs: 35_000,
    // A failed repair leaves the prior plan untouched — fail closed.
    degradation: "fail_closed",
  },
  "safety-check": {
    model: null,
    temperature: 0,
    maxTokens: 1024,
    timeoutMs: 20_000,
    costBudgetUsdPerCall: 0.003,
    latencyBudgetMs: 10_000,
    // The deterministic pre-classifier still blocks crisis input when the
    // provider is down; ambiguous input fails safe per check-input.ts.
    degradation: "fail_closed",
  },
};

export function policyFor(route: AiRouteName): ModelPolicy {
  return MODEL_POLICIES[route];
}

export function modelFor(route: AiRouteName): string {
  return MODEL_POLICIES[route].model ?? serverEnv.aiModel;
}

/**
 * Kill switch (Prompt 14): AI_KILL_SWITCH is a comma-separated list of route
 * names, model ids, prompt version ids, or "all". Matching requests are
 * refused before any provider call. Changing the env var in Vercel is the
 * rollback-safe off switch; every trip is logged (route + model only).
 */
export function parseKillSwitch(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isKilled(args: {
  route?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  raw?: string | null;
}): boolean {
  const switches = parseKillSwitch(args.raw ?? process.env.AI_KILL_SWITCH);
  if (!switches.size) return false;
  if (switches.has("all")) return true;
  for (const v of [args.route, args.model, args.promptVersion]) {
    if (v && switches.has(v.toLowerCase())) return true;
  }
  return false;
}
