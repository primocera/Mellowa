import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";
import { pruneExpiredData } from "@/lib/privacy/retention";
import { runCronJob } from "@/lib/ops/run-cron-job";

/**
 * Data-retention pruning (v6 Prompt 15). Separated from the daily-reminder
 * job so a failure in either can never hide the other. Idempotent — pruning
 * an already-pruned window deletes nothing.
 *
 * MW-05: runs through the shared cron helper, which acquires the registry's
 * cron_leases lease (fail-closed: a run whose lease cannot be evaluated skips
 * rather than double-pruning) and records a durable cron_runs row readiness
 * consumes. Vercel Hobby allows only two native crons (used by reminders);
 * trigger this route with the free external pinger (cron-job.org, daily) using
 * `Authorization: Bearer <CRON_SECRET>`. See docs/ops-cron.md.
 */
export async function POST(request: Request) {
  const denied = requireBearerSecret(request, serverEnv.cronSecret);
  if (denied) return denied;

  let pruned: Record<string, number> = {};
  let purgedDeletionJobs = 0;

  const outcome = await runCronJob(
    "retention",
    async ({ admin }) => {
      pruned = await pruneExpiredData();

      // MW-V18-04: drop completed (already-minimised) account-deletion job rows
      // once past their retention window. A failure here must be surfaced as a
      // degraded run, not hidden — but it must not throw away the pruning above.
      let purgeFailed = false;
      try {
        const { data, error } = await admin.rpc("purge_completed_deletion_jobs", {
          p_retain_days: 30,
        });
        if (error) throw new Error(error.message);
        purgedDeletionJobs = (data as number | null) ?? 0;
      } catch (err) {
        purgeFailed = true;
        console.error("[privacy] deletion-job purge failed", {
          message: err instanceof Error ? err.message : "unknown",
        });
      }

      const processed =
        Object.values(pruned).reduce((a, b) => a + b, 0) + purgedDeletionJobs;
      // Partial failure → non-success (degraded) evidence rather than blanket ok.
      return purgeFailed
        ? { processed, ok: false, errorCategory: "partial_purge_failure" }
        : { processed };
    },
    { leaseFailurePolicy: "fail_closed" }
  );

  if (!outcome.ran) {
    // Lease held elsewhere or unevaluable — a safe no-op for this trigger.
    return NextResponse.json({ ok: true, skipped: outcome.status }, { status: 200 });
  }
  return NextResponse.json(
    { ok: outcome.status === "success", pruned, purgedDeletionJobs },
    { status: outcome.status === "success" ? 200 : 500 }
  );
}

export const GET = POST;
