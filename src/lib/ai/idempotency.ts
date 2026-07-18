import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Generation idempotency (Launch audit v6, Prompt 7).
 *
 * Every intentional generation carries a client idempotency key. The claim
 * RPC serializes duplicates: only the first caller generates; concurrent or
 * retried requests see the in-progress/succeeded state instead of launching
 * another provider call.
 */

export type ClaimResult =
  | { claimed: true; requestId: string }
  | { claimed: false; status: "in_progress" | "succeeded" | "failed"; resultId: string | null }
  | { claimed: true; requestId: null; degraded: true };

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Validates a client-supplied idempotency key (uuid-ish, bounded). */
export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && KEY_PATTERN.test(key);
}

export async function claimGenerationRequest(
  supabase: SupabaseClient,
  args: {
    userId: string;
    route: string;
    idempotencyKey: string;
    localDate?: string | null;
  }
): Promise<ClaimResult> {
  const { data, error } = await supabase.rpc("claim_generation_request", {
    p_user_id: args.userId,
    p_route: args.route,
    p_idempotency_key: args.idempotencyKey,
    p_local_date: args.localDate ?? null,
  });

  if (error || !data) {
    // Missing migration or transient DB error: degrade to the previous
    // behavior (no idempotency) instead of blocking every generation.
    console.error("[idempotency] claim failed, degrading", {
      message: error?.message,
    });
    return { claimed: true, requestId: null, degraded: true };
  }

  const row = data as {
    claimed: boolean;
    request_id?: string;
    status?: "in_progress" | "succeeded" | "failed";
    result_id?: string | null;
  };
  if (row.claimed) return { claimed: true, requestId: row.request_id ?? null } as ClaimResult;
  return {
    claimed: false,
    status: row.status ?? "in_progress",
    resultId: row.result_id ?? null,
  };
}

export async function finishGenerationRequest(
  supabase: SupabaseClient,
  args: {
    requestId: string | null;
    userId: string;
    status: "succeeded" | "failed";
    resultId?: string | null;
  }
): Promise<void> {
  if (!args.requestId) return; // degraded claim — nothing to finish
  const { error } = await supabase.rpc("finish_generation_request", {
    p_request_id: args.requestId,
    p_user_id: args.userId,
    p_status: args.status,
    p_result_id: args.resultId ?? null,
  });
  if (error) {
    console.error("[idempotency] finish failed", { message: error.message });
  }
}
