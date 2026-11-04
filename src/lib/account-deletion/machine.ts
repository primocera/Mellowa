/**
 * Account-deletion state machine (MW-V18-04) — pure, dependency-injected core.
 *
 * No server-only imports so tests can load it directly. All I/O is behind the
 * `DeletionDeps` interface; `processDeletionRequest` drives one job as far as it
 * can in a single pass and is safe to call repeatedly (every transition is
 * conditional and idempotent). See docs/runbooks/account-deletion.md for the
 * ordering rationale and threat model.
 */

export const DELETION_STATUSES = [
  "requested",
  "billing_verified",
  "subscription_cancelled",
  "auth_deleted",
  "data_verified",
  "notification_queued",
  "completed",
] as const;

export type DeletionStatus = (typeof DELETION_STATUSES)[number];

export interface DeletionJob {
  id: string;
  user_id: string | null;
  status: DeletionStatus;
  attempts: number;
  billing_ref: string | null;
  recipient_email: string | null;
  residual_tables: string[];
}

/** What happens to a table's rows on deletion (mirror of the privacy registry). */
export interface RegistryEntry {
  table: string;
  column: string;
  onDelete: "cascade" | "anonymize";
}

export interface SubscriptionRow {
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  status: string | null;
}

export type OwnershipResult =
  | { kind: "owned"; customerId: string }
  | { kind: "mismatch" }
  | { kind: "missing" }
  | { kind: "unavailable" };

/** A read result that distinguishes a genuine miss from a query/transport error. */
export interface ReadResult<T> {
  data: T | null;
  error: boolean;
}

export interface DeletionDeps {
  registry: RegistryEntry[];
  /** Read the user's subscription row. `error:true` on any query failure. */
  readSubscription(userId: string): Promise<ReadResult<SubscriptionRow>>;
  verifyOwnership(customerId: string, userId: string): Promise<OwnershipResult>;
  /** Cancel a subscription; `alreadyGone` tolerates an already-cancelled one. */
  cancelSubscription(
    subscriptionId: string
  ): Promise<{ ok: boolean; alreadyGone?: boolean; error?: string }>;
  /** Delete the auth identity. `notFound:true` when it is already gone. */
  deleteAuthUser(userId: string): Promise<{ notFound: boolean; error?: string }>;
  /** Look the identity up. `present` only trustworthy when `error` is false. */
  getUserById(userId: string): Promise<{ present: boolean; error: boolean }>;
  countRows(table: string, column: string, userId: string): Promise<ReadResult<number>>;
  deleteRows(table: string, column: string, userId: string): Promise<{ error: boolean }>;
  /** Queue the confirmation email through the durable outbox. Never throws. */
  queueNotification(args: {
    eventKey: string;
    to: string;
  }): Promise<{ queued: boolean }>;
  /** Record the authoritative, id-less analytics event exactly once. */
  recordCompletedEvent(): void;
  /** Persist a partial update to the job row. */
  persist(id: string, patch: Partial<DeletionJobPatch>): Promise<void>;
  now?(): number;
}

export interface DeletionJobPatch {
  status: DeletionStatus;
  attempts: number;
  next_attempt_at: string;
  last_error_code: string | null;
  billing_ref: string | null;
  recipient_email: string | null;
  residual_tables: string[];
  user_id: string | null;
  completed_at: string | null;
  worker_leased_until: string | null;
}

export interface ProcessResult {
  status: DeletionStatus;
  /** Set when the pass stopped early on a recoverable failure. */
  errorCode?: string;
  /** True once the job reached `completed`. */
  done: boolean;
}

/** Bounded exponential backoff with jitter: ~2,4,8,16,32… min, capped 60 min. */
export function deletionBackoffMinutes(
  attempts: number,
  random: () => number = Math.random
): number {
  const base = Math.min(2 * 2 ** Math.max(0, attempts - 1), 60);
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.max(1, Math.round(base * jitter));
}

/**
 * Fail a pass: bump attempts, schedule a retry with backoff, record the error
 * code, and STOP without advancing status. The job stays fully resumable.
 */
async function fail(
  deps: DeletionDeps,
  job: DeletionJob,
  code: string,
  now: number
): Promise<ProcessResult> {
  const attempts = job.attempts + 1;
  const nextMs = now + deletionBackoffMinutes(attempts) * 60_000;
  await deps.persist(job.id, {
    attempts,
    next_attempt_at: new Date(nextMs).toISOString(),
    last_error_code: code,
    worker_leased_until: null,
  });
  return { status: job.status, errorCode: code, done: false };
}

export async function processDeletionRequest(
  input: DeletionJob,
  deps: DeletionDeps
): Promise<ProcessResult> {
  const now = deps.now?.() ?? Date.now();
  const job: DeletionJob = { ...input };

  if (!job.user_id && job.status !== "completed") {
    // A non-completed job with no user id cannot be driven — the id is the one
    // thing the worker must never lose. Surface it rather than guessing success.
    return fail(deps, job, "missing_user_id", now);
  }
  const userId = job.user_id as string;

  // 1) requested -> billing_verified
  if (job.status === "requested") {
    const sub = await deps.readSubscription(userId);
    if (sub.error) return fail(deps, job, "billing_unavailable", now);

    const row = sub.data;
    const cancellable =
      !!row?.stripe_subscription_id &&
      !!row.status &&
      !["canceled", "incomplete_expired"].includes(row.status);

    let billingRef: string | null = null;
    if (cancellable) {
      if (!row!.stripe_customer_id) {
        // A live sub we cannot attribute: never cancel or delete over it.
        return fail(deps, job, "billing_reconciliation_required", now);
      }
      const owned = await deps.verifyOwnership(row!.stripe_customer_id, userId);
      if (owned.kind === "unavailable") return fail(deps, job, "billing_unavailable", now);
      if (owned.kind === "mismatch")
        return fail(deps, job, "billing_reconciliation_required", now);
      // owned -> remember what to cancel; missing -> nothing to cancel.
      if (owned.kind === "owned") billingRef = row!.stripe_subscription_id;
    }

    await deps.persist(job.id, {
      status: "billing_verified",
      billing_ref: billingRef,
      last_error_code: null,
    });
    job.status = "billing_verified";
    job.billing_ref = billingRef;
  }

  // 2) billing_verified -> subscription_cancelled
  if (job.status === "billing_verified") {
    if (job.billing_ref) {
      const res = await deps.cancelSubscription(job.billing_ref);
      if (!res.ok && !res.alreadyGone) {
        return fail(deps, job, "billing_cancel_failed", now);
      }
    }
    await deps.persist(job.id, { status: "subscription_cancelled", last_error_code: null });
    job.status = "subscription_cancelled";
  }

  // 3) subscription_cancelled -> auth_deleted
  if (job.status === "subscription_cancelled") {
    const del = await deps.deleteAuthUser(userId);
    if (del.error && !del.notFound) return fail(deps, job, "auth_delete_failed", now);

    // Verify the identity is actually gone. A READ error here must fail closed —
    // we never claim deletion on an ambiguous read.
    const check = await deps.getUserById(userId);
    if (check.error) return fail(deps, job, "auth_verify_unavailable", now);
    if (check.present) return fail(deps, job, "auth_delete_unverified", now);

    await deps.persist(job.id, { status: "auth_deleted", last_error_code: null });
    job.status = "auth_deleted";
  }

  // 4) auth_deleted -> data_verified (residual count == 0 for every owned table)
  if (job.status === "auth_deleted") {
    const residual = new Set(job.residual_tables);
    for (const entry of deps.registry) {
      if (entry.onDelete === "anonymize") continue; // FK ON DELETE SET NULL
      const counted = await deps.countRows(entry.table, entry.column, userId);
      if (counted.error) return fail(deps, job, "residual_query_error", now);
      if ((counted.data ?? 0) > 0) {
        residual.add(entry.table);
        const del = await deps.deleteRows(entry.table, entry.column, userId);
        if (del.error) {
          await deps.persist(job.id, { residual_tables: [...residual] });
          return fail(deps, job, "residual_delete_error", now);
        }
        // Re-verify: success means zero remain, not merely that we tried.
        const recount = await deps.countRows(entry.table, entry.column, userId);
        if (recount.error) return fail(deps, job, "residual_query_error", now);
        if ((recount.data ?? 0) > 0) {
          await deps.persist(job.id, { residual_tables: [...residual] });
          return fail(deps, job, "residual_not_cleared", now);
        }
      }
    }
    await deps.persist(job.id, {
      status: "data_verified",
      residual_tables: [...residual],
      last_error_code: null,
    });
    job.status = "data_verified";
    job.residual_tables = [...residual];
  }

  // 5) data_verified -> notification_queued (best-effort; never traps the job)
  if (job.status === "data_verified") {
    let code: string | null = null;
    if (job.recipient_email) {
      const res = await deps.queueNotification({
        eventKey: `account_deleted:${userId}`,
        to: job.recipient_email,
      });
      // Email delivery is durable + retried by the outbox worker. If we could not
      // even enqueue it, record it for ops but DO NOT trap the deletion.
      if (!res.queued) code = "notification_not_queued";
    }
    await deps.persist(job.id, { status: "notification_queued", last_error_code: code });
    job.status = "notification_queued";
  }

  // 6) notification_queued -> completed (record event + minimise the record)
  if (job.status === "notification_queued") {
    deps.recordCompletedEvent();
    await deps.persist(job.id, {
      status: "completed",
      user_id: null, // minimisation: the raw id is dropped; the hash remains
      recipient_email: null,
      completed_at: new Date(now).toISOString(),
      worker_leased_until: null,
      last_error_code: null,
    });
    job.status = "completed";
  }

  return { status: job.status, done: job.status === "completed" };
}
