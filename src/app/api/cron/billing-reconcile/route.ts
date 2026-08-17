import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";
import { getStripe } from "@/lib/stripe/client";
import { reconcileBilling } from "@/lib/stripe/reconcile";
import { runCronJob } from "@/lib/ops/run-cron-job";

/**
 * Billing reconciliation job (Launch v6, Prompt 18). Compares every local
 * subscription row with live Stripe state, fixes drift (Stripe wins) and
 * surfaces exceptions: unresolvable subscriptions, duplicate customers,
 * unknown prices and failed/stuck webhook events.
 *
 * Trigger daily via the external pinger (cron-job.org) with
 * `Authorization: Bearer <CRON_SECRET>` — Vercel Hobby's two native crons
 * are taken. Exceptions are returned in the response and logged; check the
 * pinger's failure notifications plus /admin for follow-up.
 */
export async function POST(request: Request) {
  const denied = requireBearerSecret(request, serverEnv.cronSecret);
  if (denied) return denied;

  // MW-05: reconciliation calls live Stripe, so a duplicate concurrent run is
  // real provider load. Run through the shared helper with a fail-closed lease
  // (a run whose lease cannot be evaluated skips rather than double-reconciling)
  // and a durable cron_runs record.
  let report: Awaited<ReturnType<typeof reconcileBilling>> | null = null;

  const outcome = await runCronJob(
    "billing-reconcile",
    async ({ admin }) => {
      report = await reconcileBilling(getStripe(), admin);
      if (!report.ok || report.driftFixed.length > 0) {
        console.error("[billing-reconcile] exceptions", {
          driftFixed: report.driftFixed.length,
          unresolvable: report.unresolvable.length,
          duplicateCustomers: report.duplicateCustomers.length,
          unknownPrices: report.unknownPrices,
          stuckWebhookEvents: report.stuckWebhookEvents.length,
        });
      }
      const processed =
        report.driftFixed.length +
        report.unresolvable.length +
        report.duplicateCustomers.length;
      return report.ok
        ? { processed }
        : { processed, ok: false, errorCategory: "reconcile_exception" };
    },
    { leaseFailurePolicy: "fail_closed" }
  );

  if (!outcome.ran) {
    return NextResponse.json({ ok: true, skipped: outcome.status }, { status: 200 });
  }
  // Non-2xx on exceptions so the pinger's own alerting notices without any
  // extra email infrastructure.
  return NextResponse.json(
    { ok: outcome.status === "success", report },
    { status: outcome.status === "success" ? 200 : 500 }
  );
}

export const GET = POST;
