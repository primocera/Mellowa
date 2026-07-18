import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";
import { pruneExpiredData } from "@/lib/privacy/retention";

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
  return NextResponse.json({ ok: true, pruned });
}

export const GET = POST;
