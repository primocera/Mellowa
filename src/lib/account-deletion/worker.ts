import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { verifyMellowaCustomerOwnership } from "@/lib/stripe/customer";
import { USER_DATA_REGISTRY } from "@/lib/privacy/registry";
import { trackEvent } from "@/lib/analytics";
import { logEvent } from "@/lib/observability/log";
import { deliverEmail } from "@/lib/email/deliver";
import { accountDeletedEmail } from "@/lib/email/templates";
import {
  processDeletionRequest,
  type DeletionDeps,
  type DeletionJob,
  type DeletionStatus,
} from "@/lib/account-deletion/machine";

/**
 * Durable worker for the account-deletion state machine (MW-V18-04).
 *
 * Two entry points share ONE processing core (processDeletionRequest):
 *   - runDeletionWorker: cron path. Claims due jobs under a DB lease
 *     (claim_due_deletion_jobs, SKIP LOCKED) and drives each one pass.
 *   - processJobById: the API path. Leases and drives ONE specific new job so a
 *     user's own deletion progresses immediately without waiting for cron and
 *     without stealing other users' due jobs.
 *
 * A crashed worker cannot wedge a job: the lease expires and the row comes due
 * again. Loss of the auth identity mid-run is expected — the job stores the
 * target user id itself (no auth FK), so completion never depends on the session.
 */

const TABLE = "account_deletion_requests";

const CANCEL_TOLERATED = /no such subscription|already canceled|resource_missing/i;

function isNotFoundAuthError(error: { status?: number; code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.status === 404) return true;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return code === "user_not_found" || msg.includes("user not found") || msg.includes("not found");
}

export function defaultDeletionDeps(
  admin: SupabaseClient = createAdminClient()
): DeletionDeps {
  return {
    registry: USER_DATA_REGISTRY,

    async readSubscription(userId) {
      const { data, error } = await admin
        .from("subscriptions")
        .select("stripe_subscription_id, stripe_customer_id, status")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return { data: null, error: true };
      return { data: (data as DeletionJobSub) ?? null, error: false };
    },

    async verifyOwnership(customerId, userId) {
      return verifyMellowaCustomerOwnership(getStripe(), customerId, userId);
    },

    async cancelSubscription(subscriptionId) {
      try {
        await getStripe().subscriptions.cancel(subscriptionId);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        if (CANCEL_TOLERATED.test(message)) return { ok: false, alreadyGone: true };
        return { ok: false, error: "cancel_failed" };
      }
    },

    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (!error) return { notFound: false };
      if (isNotFoundAuthError(error)) return { notFound: true };
      return { notFound: false, error: "delete_failed" };
    },

    async getUserById(userId) {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error) {
        // A 404 is a definite "gone" (success signal); anything else is a read
        // failure we must NOT interpret as deleted.
        if (isNotFoundAuthError(error)) return { present: false, error: false };
        return { present: false, error: true };
      }
      return { present: !!data?.user, error: false };
    },

    async countRows(table, column, userId) {
      const { count, error } = await admin
        .from(table)
        .select(column, { count: "exact", head: true })
        .eq(column, userId);
      if (error) return { data: null, error: true };
      return { data: count ?? 0, error: false };
    },

    async deleteRows(table, column, userId) {
      const { error } = await admin.from(table).delete().eq(column, userId);
      return { error: !!error };
    },

    async queueNotification({ eventKey, to }) {
      try {
        const { subject, html } = accountDeletedEmail();
        await deliverEmail({
          eventKey,
          userId: null, // the ledger row must survive the account cascade
          template: "account_deleted",
          to,
          subject,
          html,
        });
        return { queued: true };
      } catch {
        // Enqueue failed (e.g. DB blip). Deletion is already done; do not trap.
        return { queued: false };
      }
    },

    recordCompletedEvent() {
      trackEvent("account_deleted", {
        userId: null,
        properties: { surface: "settings", outcome: "success" },
      });
    },

    async persist(id, patch) {
      await admin
        .from(TABLE)
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
    },
  };
}

interface DeletionJobSub {
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  status: string | null;
}

interface RawJobRow {
  id: string;
  user_id: string | null;
  status: DeletionStatus;
  attempts: number;
  billing_ref: string | null;
  recipient_email: string | null;
  residual_tables: string[] | null;
}

function toJob(row: RawJobRow): DeletionJob {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    attempts: row.attempts,
    billing_ref: row.billing_ref,
    recipient_email: row.recipient_email,
    residual_tables: row.residual_tables ?? [],
  };
}

export interface WorkerSummary {
  claimed: number;
  completed: number;
  retried: number;
}

/** Cron entry point: claim and drive up to `limit` due jobs. */
export async function runDeletionWorker(
  limit = 5,
  admin: SupabaseClient = createAdminClient(),
  deps: DeletionDeps = defaultDeletionDeps(admin)
): Promise<WorkerSummary> {
  const { data, error } = await admin.rpc("claim_due_deletion_jobs", { p_limit: limit });
  if (error) {
    // Structured, redacted, runbook-correlatable — maps to the deletion_stuck SLO.
    logEvent({ route: "job/account-deletion", result: "error", code: "claim_failed" });
    return { claimed: 0, completed: 0, retried: 0 };
  }
  const rows = (data ?? []) as RawJobRow[];
  const summary: WorkerSummary = { claimed: rows.length, completed: 0, retried: 0 };
  for (const row of rows) {
    const res = await processDeletionRequest(toJob(row), deps);
    if (res.done) summary.completed += 1;
    else summary.retried += 1;
  }
  return summary;
}

/**
 * API entry point: lease ONE specific job by id and drive it. Returns the
 * resulting status, or null when the job is busy (leased by another worker) or
 * not found. Race-safe via a conditional update on the lease column.
 */
export async function processJobById(
  requestId: string,
  admin: SupabaseClient = createAdminClient(),
  deps: DeletionDeps = defaultDeletionDeps(admin),
  leaseMinutes = 5
): Promise<{ status: DeletionStatus } | null> {
  const nowIso = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + leaseMinutes * 60_000).toISOString();
  const { data, error } = await admin
    .from(TABLE)
    .update({ worker_leased_until: leaseUntil, updated_at: nowIso })
    .eq("id", requestId)
    .neq("status", "completed")
    .or(`worker_leased_until.is.null,worker_leased_until.lt.${nowIso}`)
    .select("id, user_id, status, attempts, billing_ref, recipient_email, residual_tables")
    .maybeSingle();

  if (error || !data) return null; // busy, completed, or gone — safe to skip
  const res = await processDeletionRequest(toJob(data as RawJobRow), deps);
  return { status: res.status };
}
