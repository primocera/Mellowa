import "server-only";
import { createClient } from "@/lib/supabase/server";
import { estimateRouteCostUsd, globalDailyCeilingUsd } from "@/lib/ai/cost";

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
  | "regenerate-section";

export interface ClaimResult {
  ok: boolean;
  /** Why the claim was denied. "capacity" = global ceiling reached. */
  scope?: "hour" | "day" | "capacity";
  retryAfterMinutes?: number;
  eventId?: string;
}

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
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_ai_generation", {
    p_user_id: userId,
    p_route: route,
    p_per_hour: AI_RATE_LIMITS.perHour,
    p_per_day: AI_RATE_LIMITS.perDay,
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
    default:
      return { ok: false, scope: "capacity", retryAfterMinutes: 15 };
  }
}
