import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";
import { deliverEmail } from "@/lib/email/deliver";
import { trialEndingEmail } from "@/lib/email/templates";

/**
 * Daily cron — sends the "your trial ends tomorrow" email to trialing users
 * whose trial ends within the next 24 hours. Idempotent via
 * subscriptions.trial_reminder_sent.
 *
 * Configured in vercel.json. Protected by CRON_SECRET (Vercel Cron sends it as
 * a Bearer token in the Authorization header).
 */
export async function GET(request: Request) {
  const denied = requireBearerSecret(request, serverEnv.cronSecret);
  if (denied) return denied;

  const admin = createAdminClient();
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const { data: due } = await admin
    .from("subscriptions")
    .select("id, user_id, trial_end")
    .eq("status", "trialing")
    .eq("trial_reminder_sent", false)
    .gt("trial_end", now.toISOString())
    .lte("trial_end", in24h.toISOString());

  let sent = 0;
  for (const row of due ?? []) {
    const { data: userData } = await admin.auth.admin.getUserById(row.user_id);
    const email = userData.user?.email;
    if (!email) continue;

    const { subject, html } = trialEndingEmail();
    const result = await deliverEmail({
      eventKey: `trial_ending:${row.id}:${row.trial_end}`,
      userId: row.user_id,
      template: "trial_ending",
      to: email,
      subject,
      html,
    });
    // Only mark the source row after real provider acceptance — a missing
    // provider or failed send must stay retryable, never recorded as sent.
    // The delivery ledger's unique event key prevents duplicate emails.
    if (result.sent || result.status === "duplicate") {
      await admin
        .from("subscriptions")
        .update({ trial_reminder_sent: true })
        .eq("id", row.id);
    }
    if (result.sent) sent += 1;
  }

  return NextResponse.json({ ok: true, considered: due?.length ?? 0, sent });
}
