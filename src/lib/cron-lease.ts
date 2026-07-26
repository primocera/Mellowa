import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MW-V10-05: cron run leases.
 *
 * Duplicate *sends* are already impossible — the email ledger's unique event
 * key sees to that. What a lease prevents is duplicated *work*: two overlapping
 * runs both scanning every profile and both calling the provider, where the
 * second run's requests only collapse into "duplicate" after they have been
 * made.
 *
 * Failure behaviour is deliberate: if the lease RPC itself errors (migration
 * not applied yet, transient DB blip), the run PROCEEDS. Idempotency does not
 * depend on the lease, so failing open here costs at worst some duplicated
 * work, while failing closed would silently stop reminders for everyone the
 * moment this table had a problem.
 */

export interface CronLease {
  acquired: boolean;
  runId: string;
  release(): Promise<void>;
}

function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function acquireCronLease(
  admin: SupabaseClient,
  jobName: string,
  ttlSeconds: number
): Promise<CronLease> {
  const runId = newRunId();
  const noop = async () => {};

  const { data, error } = await admin.rpc("claim_cron_run", {
    p_job_name: jobName,
    p_ttl_seconds: ttlSeconds,
    p_run_id: runId,
  });

  if (error) {
    // Fail OPEN — see the module comment. Logged so it is visible in ops.
    console.warn("[cron-lease] could not evaluate lease, proceeding", {
      job: jobName,
      message: error.message,
    });
    return { acquired: true, runId, release: noop };
  }

  if (data !== true) {
    return { acquired: false, runId, release: noop };
  }

  return {
    acquired: true,
    runId,
    async release() {
      // Best effort: an unreleased lease simply expires on its own.
      const { error: relError } = await admin.rpc("release_cron_run", {
        p_job_name: jobName,
        p_run_id: runId,
      });
      if (relError) {
        console.warn("[cron-lease] release failed; lease will expire", {
          job: jobName,
          message: relError.message,
        });
      }
    },
  };
}
