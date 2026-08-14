import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";
import { pruneExpiredData } from "@/lib/privacy/retention";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Data-retention pruning (v6 Prompt 15). Separated from the daily-reminder
 * job so a failure in either can never hide the other. Idempotent — pruning
 * an already-pruned window deletes nothing.
 *
 * Vercel Hobby allows only two native crons (used by reminders); trigger this
 * route with the free external pinger (cron-job.org, daily) using
 * `Authorization: Bearer <CRON_SECRET>`. See docs/ops-cron.md.
 */
export async function POST(request: Request) {
  const denied = requireBearerSecret(request, serverEnv.cronSecret);
  if (denied) return denied;

  const pruned = await pruneExpiredData();

  // MW-V18-04: drop completed (already-minimised) account-deletion job rows once
  // past their retention window, so the operational ledger never lingers. A
  // failure here must not hide the registry pruning above.
  let purgedDeletionJobs = 0;
  try {
    const { data, error } = await createAdminClient().rpc(
      "purge_completed_deletion_jobs",
      { p_retain_days: 30 }
    );
    if (error) throw new Error(error.message);
    purgedDeletionJobs = (data as number | null) ?? 0;
  } catch (err) {
    console.error("[privacy] deletion-job purge failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  return NextResponse.json({ ok: true, pruned, purgedDeletionJobs });
}

export const GET = POST;
