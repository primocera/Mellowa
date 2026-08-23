import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MW-02 (v20): atomic pre-provider daily-plan claim.
 *
 * Wraps the claim_daily_plan_generation / finish_daily_plan_generation RPCs
 * (migration 051). The claim is keyed by (user_id, canonical local date) and is
 * independent of the client idempotency key, so two concurrent requests with
 * DIFFERENT keys cannot both spend AI budget for one canonical day: exactly one
 * becomes the `claimed` winner, everyone else is a follower.
 *
 * Failure policy: if the claim RPC errors (missing migration 051 or a transient
 * DB fault) we DO NOT degrade to "let everyone generate" — that would reopen the
 * duplicate-cost hole this fixes. We surface `unavailable` and the route fails
 * closed (503). This mirrors the billing/quota fail-closed rule.
 */

/**
 * The (user, day) claim lease, in seconds. A single request holds it across the
 * whole generation — including the quality and allergen regenerations.
 */
export const DAILY_PLAN_LEASE_SECONDS = 120;

/**
 * WS-B (v21): total provider wall-time budget for ONE daily-plan request, shared
 * across every generation call it makes (initial + quality retry + allergen
 * retry, each of which may itself retry once on rate-limit/overload). Held
 * comfortably below the lease so the claim can never expire while the original
 * request is still legitimately awaiting the provider — which would let a
 * follower reclaim the day and incur a second billable generation. The ~20s
 * headroom also covers the surrounding DB writes inside the lease.
 */
export const DAILY_PLAN_PROVIDER_BUDGET_MS = 100_000;

export type DailyClaimResult =
  | { outcome: "claimed"; ownerRequestId: string; attempt: number; reclaimed: boolean }
  | { outcome: "in_progress"; retryAfterSeconds: number }
  | { outcome: "duplicate"; resultId: string | null }
  | { outcome: "unavailable" };

export async function claimDailyPlanGeneration(
  supabase: SupabaseClient,
  args: { userId: string; localDate: string; leaseSeconds?: number }
): Promise<DailyClaimResult> {
  const { data, error } = await supabase.rpc("claim_daily_plan_generation", {
    p_user_id: args.userId,
    p_local_date: args.localDate,
    p_lease_seconds: args.leaseSeconds ?? 120,
  });

  if (error || !data) {
    // Fail closed — never fall back to unguarded generation.
    console.error("[daily-claim] claim failed, failing closed", {
      message: error?.message,
    });
    return { outcome: "unavailable" };
  }

  const row = data as {
    outcome: "claimed" | "in_progress" | "duplicate";
    owner_request_id?: string;
    attempt?: number;
    reclaimed?: boolean;
    retry_after_seconds?: number;
    status?: string;
    result_id?: string | null;
  };

  if (row.outcome === "claimed") {
    return {
      outcome: "claimed",
      ownerRequestId: row.owner_request_id ?? "",
      attempt: row.attempt ?? 1,
      reclaimed: Boolean(row.reclaimed),
    };
  }
  if (row.outcome === "in_progress") {
    return {
      outcome: "in_progress",
      retryAfterSeconds: row.retry_after_seconds ?? 5,
    };
  }
  return { outcome: "duplicate", resultId: row.result_id ?? null };
}

export async function finishDailyPlanGeneration(
  supabase: SupabaseClient,
  args: {
    userId: string;
    localDate: string;
    ownerRequestId: string;
    status: "succeeded" | "failed";
    resultId?: string | null;
    failureCode?: string | null;
  }
): Promise<void> {
  if (!args.ownerRequestId) return; // never claimed → nothing to finish
  const { error } = await supabase.rpc("finish_daily_plan_generation", {
    p_user_id: args.userId,
    p_local_date: args.localDate,
    p_owner_request_id: args.ownerRequestId,
    p_status: args.status,
    p_result_id: args.resultId ?? null,
    p_failure_code: args.failureCode ?? null,
  });
  if (error) {
    console.error("[daily-claim] finish failed", { message: error.message });
  }
}
