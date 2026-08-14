import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";
import { runDeletionWorker } from "@/lib/account-deletion/worker";

/**
 * Durable account-deletion worker (MW-V18-04). Claims due jobs under a DB lease
 * (SKIP LOCKED) and drives each one pass; a job the API's inline pass could not
 * finish — or a job left fully async by FLAG_ACCOUNT_DELETION_SYNC=0 — is
 * completed here. Idempotent: re-running claims nothing already leased/done.
 *
 * Vercel Hobby allows only two native crons (used by the reminder jobs), so
 * trigger this route with the free external pinger (cron-job.org, every few
 * minutes) using `Authorization: Bearer <CRON_SECRET>`. See docs/ops-cron.md.
 */
export async function POST(request: Request) {
  const denied = requireBearerSecret(request, serverEnv.cronSecret);
  if (denied) return denied;

  const summary = await runDeletionWorker();
  return NextResponse.json({ ok: true, ...summary });
}

export const GET = POST;
