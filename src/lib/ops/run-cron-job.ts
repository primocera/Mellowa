import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { acquireCronLease } from "@/lib/cron-lease";
import { CRON_REGISTRY, type CronJob } from "@/lib/ops/cron-registry";
import { releaseVersion } from "@/lib/health";

/**
 * MW-05: one shared execution helper every cron job runs through.
 *
 * It (1) validates the caller against the registry, (2) acquires the
 * registry-declared cron_leases lease when the job uses that mechanism, with an
 * EXPLICIT failure policy, (3) records a durable cron_runs row (start →
 * success/failure/skip) with processed counts, a safe error category, the lease
 * outcome and the release sha, so readiness can consume a real last-success.
 *
 * Lease-failure policy is explicit per job: a job where a duplicate run would
 * cost provider spend or mutate data ("fail_closed") does NOT silently proceed
 * when the lease cannot be evaluated — it records `lease_unavailable` and skips.
 * An idempotent job ("proceed") may run anyway (duplicated work is harmless).
 */

export type LeaseFailurePolicy = "proceed" | "fail_closed";

export interface CronRunOutcome {
  ran: boolean;
  status: "success" | "failure" | "skipped_locked" | "lease_unavailable";
  processed: number | null;
  errorCategory: string | null;
  runId: string;
}

export interface CronHandlerResult {
  processed?: number | null;
  /** Optional explicit ok flag; a thrown error is always a failure. */
  ok?: boolean;
  /** Optional safe error category to record on a non-ok (non-thrown) result. */
  errorCategory?: string | null;
}

function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function usesCronLeases(job: CronJob): boolean {
  return /cron_leases/i.test(job.lease.mechanism);
}

async function safe(p: PromiseLike<unknown>): Promise<void> {
  try {
    await p;
  } catch {
    /* ledger writes are best-effort; never let them fail the job */
  }
}

/**
 * Run `handler` as the registered job `jobId`. Returns the recorded outcome.
 * `handler` receives the admin client and the run id.
 */
export async function runCronJob(
  jobId: string,
  handler: (ctx: {
    admin: SupabaseClient;
    runId: string;
  }) => Promise<CronHandlerResult | void>,
  opts: { leaseFailurePolicy?: LeaseFailurePolicy } = {}
): Promise<CronRunOutcome> {
  const job = CRON_REGISTRY.find((j) => j.id === jobId);
  if (!job) {
    throw new Error(`runCronJob: unknown job id "${jobId}" (not in CRON_REGISTRY)`);
  }
  const admin = createAdminClient();
  const runId = newRunId();
  const sha = releaseVersion();

  let ledgerId: string | null = null;
  {
    const { data } = await admin.rpc("record_cron_run_start", {
      p_job_id: jobId,
      p_run_id: runId,
      p_release_sha: sha,
    });
    ledgerId = (typeof data === "string" ? data : null) as string | null;
  }
  const finish = (
    status: CronRunOutcome["status"],
    processed: number | null,
    errorCategory: string | null,
    leaseOutcome: string
  ) => {
    if (!ledgerId) return Promise.resolve();
    return safe(
      admin.rpc("record_cron_run_finish", {
        p_id: ledgerId,
        p_status: status,
        p_processed: processed,
        p_error_category: errorCategory,
        p_lease_outcome: leaseOutcome,
      })
    );
  };

  // Overlap protection for cron_leases-mechanism jobs.
  let release: (() => Promise<void>) | null = null;
  let leaseOutcome = "not_applicable";
  if (usesCronLeases(job)) {
    const policy = opts.leaseFailurePolicy ?? "proceed";
    const lease = await acquireCronLease(admin, job.id, (job.lease.minutes ?? 10) * 60);
    if (!lease.acquired) {
      // Another run holds the lease — safe no-op.
      await finish("skipped_locked", 0, null, "skipped");
      return { ran: false, status: "skipped_locked", processed: 0, errorCategory: null, runId };
    }
    // acquireCronLease fails OPEN on an RPC error (acquired:true, evaluated:false).
    // For a fail_closed job (duplicate run costs provider spend / mutates), that
    // is not acceptable: record lease_unavailable and skip rather than risk a
    // duplicate. An idempotent "proceed" job runs anyway.
    if (!lease.evaluated && policy === "fail_closed") {
      await finish("lease_unavailable", 0, "lease_unavailable", "unavailable");
      return {
        ran: false,
        status: "lease_unavailable",
        processed: 0,
        errorCategory: "lease_unavailable",
        runId,
      };
    }
    leaseOutcome = lease.evaluated ? "acquired" : "acquired_unevaluated";
    release = lease.release;
  }

  let processed: number | null = null;
  let errorCategory: string | null = null;
  try {
    const result = (await handler({ admin, runId })) ?? {};
    processed = result.processed ?? null;
    if (result.ok === false) {
      errorCategory = result.errorCategory ?? "job_reported_failure";
      await finish("failure", processed, errorCategory, leaseOutcome);
      if (release) await safe(release());
      return { ran: true, status: "failure", processed, errorCategory, runId };
    }
    await finish("success", processed, null, leaseOutcome);
    if (release) await safe(release());
    return { ran: true, status: "success", processed, errorCategory: null, runId };
  } catch (err) {
    errorCategory = err instanceof Error ? categorize(err) : "unknown";
    await finish("failure", processed, errorCategory, leaseOutcome);
    if (release) await safe(release());
    return { ran: true, status: "failure", processed, errorCategory, runId };
  }
}

/** Map an error to a coarse, non-sensitive category (never a message). */
function categorize(err: Error): string {
  const m = err.message.toLowerCase();
  if (/timeout|timed out/.test(m)) return "timeout";
  if (/permission|denied|unauthor/.test(m)) return "permission";
  if (/stripe|provider|api/.test(m)) return "provider_error";
  if (/database|sql|relation|pg|supabase/.test(m)) return "db_error";
  return "job_error";
}
