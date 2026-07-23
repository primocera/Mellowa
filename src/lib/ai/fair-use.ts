import "server-only";
import { estimateRouteCostUsd } from "@/lib/ai/cost";

/**
 * MW-V9-10: explicit, bounded fair-use policy for Premium AI generation.
 *
 * Premium is "ongoing daily plans with fair-use safeguards" — never
 * "unlimited". The per-hour/per-day limits and the global spend ceiling protect
 * the system in a spike, but a single account generating at the daily cap every
 * day would exceed the economics of a €59.99/year plan. This module adds one
 * explicit monthly abuse cap: generous enough that ordinary and even heavy
 * daily use never reaches it, low enough to stop pathological/abusive use.
 *
 * The number is a published safeguard, not a hidden throttle: the value is
 * surfaced in copy and the reset window is stated when a user reaches it.
 */

/**
 * Trailing-30-day generation cap across ALL AI routes, per user. Sizing:
 *  - typical use ~1 plan/day ≈ 30/month
 *  - heavy use ~2/day plus adjustments/weekly ≈ 90/month
 *  - this cap sits well above heavy use and only bites abuse/runaway loops.
 * Tunable via env; the migration-035 overload enforces it atomically.
 */
export function monthlyGenerationCap(): number {
  const raw = process.env.AI_MONTHLY_GENERATION_CAP;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 300;
}

export interface FairUseState {
  monthlyCount: number;
  cap: number;
  withinBudget: boolean;
  /** Soft-warn threshold reached (≥80% of cap) — surface a heads-up, no block. */
  softWarn: boolean;
  remaining: number;
}

/** Pure classification of a user's trailing-month usage against the cap. */
export function fairUseState(monthlyCount: number, cap = monthlyGenerationCap()): FairUseState {
  const remaining = Math.max(0, cap - monthlyCount);
  return {
    monthlyCount,
    cap,
    withinBudget: monthlyCount < cap,
    softWarn: monthlyCount >= Math.floor(cap * 0.8),
    remaining,
  };
}

/**
 * Synthetic monthly AI cost per user (USD) under a representative usage mix.
 * Every daily plan is preceded by a safety classification (a small extra call);
 * we fold that in as a flat per-active-day overhead. Assumptions are explicit so
 * the go/no-go scorecard can show the workings rather than a magic number.
 */
export interface UsageMix {
  /** Daily plans per active day. */
  dailyPlansPerDay: number;
  /** Whole-day repairs per week. */
  repairsPerWeek: number;
  /** Weekly plans per week. */
  weeklyPlansPerWeek: number;
  /** Active days per month. */
  activeDaysPerMonth: number;
  /** Fraction of generations that hit the one bounded retry (0..1). */
  retryRate: number;
}

export const USAGE_MIXES: Record<"light" | "typical" | "high", UsageMix> = {
  light: { dailyPlansPerDay: 1, repairsPerWeek: 0, weeklyPlansPerWeek: 0, activeDaysPerMonth: 12, retryRate: 0.05 },
  typical: { dailyPlansPerDay: 1, repairsPerWeek: 1, weeklyPlansPerWeek: 1, activeDaysPerMonth: 20, retryRate: 0.1 },
  high: { dailyPlansPerDay: 2, repairsPerWeek: 3, weeklyPlansPerWeek: 1, activeDaysPerMonth: 26, retryRate: 0.15 },
};

/** A safety classification runs before every daily plan; approximate its cost
 *  as a small classify call. Kept explicit so it is never silently omitted. */
const SAFETY_CHECK_COST_USD = estimateRouteCostUsd("journal-reflection") * 0.5;

export function syntheticMonthlyCostUsd(mix: UsageMix): number {
  const weeksPerMonth = mix.activeDaysPerMonth / 7;
  const dailyPlans = mix.dailyPlansPerDay * mix.activeDaysPerMonth;
  const repairs = mix.repairsPerWeek * weeksPerMonth;
  const weekly = mix.weeklyPlansPerWeek * weeksPerMonth;

  const base =
    dailyPlans * (estimateRouteCostUsd("daily-plan") + SAFETY_CHECK_COST_USD) +
    repairs * estimateRouteCostUsd("plan-repair") +
    weekly * estimateRouteCostUsd("weekly-plan");

  // Each bounded retry re-runs one generation at roughly the same footprint.
  return base * (1 + mix.retryRate);
}
