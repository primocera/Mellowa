import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { estimateRouteCostUsd, globalDailyCeilingUsd } from "@/lib/ai/cost";
import { monthlyGenerationCap } from "@/lib/ai/fair-use";
import { isFlagEnabled } from "@/lib/flags";

/**
 * AI generation limits (Prompt 16) — protects the AI provider key and caps
 * global spend. Backed by ai_usage_events. The claim is ATOMIC: a single
 * SECURITY DEFINER RPC checks the per-user hour/day limits and the global daily
 * cost ceiling under a per-user advisory lock, then reserves the slot by
 * inserting a ledger row. This closes the check-then-insert race that a
 * two-step count+insert would leave open.
 */
export const AI_RATE_LIMITS = {
  perHour: 15,
  perDay: 40,
} as const;

export type AiRoute =
  | "daily-plan"
  | "weekly-plan"
  | "meal-rhythm"
  | "habit-plan"
  | "journal-reflection"
  | "low-energy-day"
  | "regenerate-section"
  | "plan-repair";

export interface ClaimResult {
  ok: boolean;
  /** Why the claim was denied. "capacity" = global ceiling reached;
   *  "month" = the per-user monthly fair-use cap. */
  scope?: "hour" | "day" | "month" | "capacity";
  retryAfterMinutes?: number;
  eventId?: string;
}

// A cap this high is effectively "no monthly cap" — used when the fair-use
// flag is off so the atomic RPC path is identical either way (rollback = flag).
const MONTHLY_CAP_DISABLED = 1_000_000;

/**
 * Atomically reserve one AI generation for the user. Call this BEFORE
 * generation; the slot (and its estimated cost) is recorded immediately, so a
 * failed provider call still counts against the quota — this is intentional and
 * abuse-resistant. Fails CLOSED (denies) if the RPC errors.
 */
export async function claimAiGeneration(
  userId: string,
  route: AiRoute
): Promise<ClaimResult> {
  // Service-role call (migration 025): the RPC is no longer executable by
  // authenticated users, so limits/cost can never be caller-chosen.
  const supabase = createAdminClient();
  // MW-V9-10: the monthly fair-use cap is a kill-switchable safeguard. When
  // FLAG_MONTHLY_FAIR_USE is off, an effectively-infinite cap makes the atomic
  // RPC behave exactly as before — a zero-risk rollback with no deploy.
  const perMonth = isFlagEnabled("monthly_fair_use")
    ? monthlyGenerationCap()
    : MONTHLY_CAP_DISABLED;
  const { data, error } = await supabase.rpc("claim_ai_generation", {
    p_user_id: userId,
    p_route: route,
    p_per_hour: AI_RATE_LIMITS.perHour,
    p_per_day: AI_RATE_LIMITS.perDay,
    p_per_month: perMonth,
    p_est_cost: estimateRouteCostUsd(route),
    p_global_daily_ceiling: globalDailyCeilingUsd(),
  });

  if (error || !data) {
    console.error("[ai] claim_ai_generation failed — denying", {
      route,
      error: error?.message,
    });
    return { ok: false, scope: "capacity", retryAfterMinutes: 5 };
  }

  const result = data as { allowed: boolean; reason?: string; event_id?: string };
  if (result.allowed) {
    return { ok: true, eventId: result.event_id };
  }

  switch (result.reason) {
    case "hour":
      return { ok: false, scope: "hour", retryAfterMinutes: 60 };
    case "day":
      return { ok: false, scope: "day", retryAfterMinutes: 24 * 60 };
    case "month":
      // Trailing-30-day window; there's no single reset instant, so guide the
      // user to a day rather than imply a hard midnight reset.
      return { ok: false, scope: "month", retryAfterMinutes: 24 * 60 };
    default:
      return { ok: false, scope: "capacity", retryAfterMinutes: 15 };
  }
}
