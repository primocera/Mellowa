import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileBilling } from "@/lib/stripe/reconcile";

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

  const report = await reconcileBilling(getStripe(), createAdminClient());
  if (!report.ok || report.driftFixed.length > 0) {
    console.error("[billing-reconcile] exceptions", {
      driftFixed: report.driftFixed.length,
      unresolvable: report.unresolvable.length,
      duplicateCustomers: report.duplicateCustomers.length,
      unknownPrices: report.unknownPrices,
      stuckWebhookEvents: report.stuckWebhookEvents.length,
    });
  }
  // Non-2xx on exceptions so the pinger's own alerting notices without any
  // extra email infrastructure.
  return NextResponse.json({ ok: report.ok, report }, { status: report.ok ? 200 : 500 });
}

export const GET = POST;
