import { NextResponse } from "next/server";
import { requireBearerSecret } from "@/lib/cron-auth";
import { replayDeliveries } from "@/lib/email/deliver";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Email outbox worker (Launch audit v6, Prompt 4).
 *
 * Replays due retryable deliveries (failed_transient / not_configured /
 * pending) with exponential backoff. Safe to trigger frequently and from
 * overlapping runs — claim_due_emails leases rows with SKIP LOCKED.
 *
 * Vercel Hobby cron is daily-only, so for faster retries point a free
 * external pinger (e.g. cron-job.org, every 10–15 min) at this route with
 * the `Authorization: Bearer <CRON_SECRET>` header. See docs/ops-cron.md.
 */
export async function POST(request: Request) {
  const unauthorized = requireBearerSecret(request, process.env.CRON_SECRET);
  if (unauthorized) return unauthorized;

  const summary = await replayDeliveries(20);
  if (summary.permanent > 0 || summary.skippedNoPayload > 0) {
    console.error("[email-outbox] dead-lettered deliveries", summary);
  }

  // Queue observability (Prompt 15): depth, oldest due job, dead letters.
  let queue: { queued: number; oldest_due: string | null; dead_lettered: number } | null = null;
  const { data: stats } = await createAdminClient().rpc("email_outbox_stats");
  const row = Array.isArray(stats) ? stats[0] : stats;
  if (row) {
    queue = {
      queued: Number(row.queued ?? 0),
      oldest_due: row.oldest_due ?? null,
      dead_lettered: Number(row.dead_lettered ?? 0),
    };
    if (queue.queued > 100) {
      console.error("[email-outbox] queue depth high", queue);
    }
  }
  return NextResponse.json({ ok: true, ...summary, queue });
}

// Vercel cron uses GET; external pingers may use either.
export const GET = POST;
