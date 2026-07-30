import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";
import { acquireCronLease } from "@/lib/cron-lease";
import { deliverEmail } from "@/lib/email/deliver";
import { trialEndingEmail } from "@/lib/email/templates";
import { getUserEmails } from "@/lib/email/recipients";
import { PRICING } from "@/lib/stripe/plans";
import { isValidTimeZone, localCalendarDaysUntil } from "@/lib/dates/local-day";

/**
 * Daily cron — sends the trial-ending email to trialing users whose trial ends
 * soon. Idempotent via subscriptions.trial_reminder_sent.
 *
 * MW-V11: the look-ahead is 48h, not 24h. Vercel runs this once a day, so a 24h
 * window anchored to the run time could only catch a trial in the single window
 * before it ended — for a trial ending later in the day than the run hour, that
 * meant a few hours' notice at best, and once provider/inbox lag was added the
 * mail could land AFTER the trial had already ended, still announcing
 * "tomorrow". 48h guarantees at least a full day of lead time for any
 * trial_end time-of-day, and the subject now names the real day.
 *
 * Configured in vercel.json. Protected by CRON_SECRET (Vercel Cron sends it as
 * a Bearer token in the Authorization header).
 */
export async function GET(request: Request) {
  const denied = requireBearerSecret(request, serverEnv.cronSecret);
  if (denied) return denied;

  const admin = createAdminClient();

  // MW-V10-05: same lease as daily-reminders. Duplicate sends were already
  // impossible via the ledger event key; this stops an overlapping trigger
  // repeating the whole scan. Fails open, so a lease problem cannot stop
  // trial-ending mail — the one email a user must never miss.
  const lease = await acquireCronLease(admin, "trial-reminders", 90);
  if (!lease.acquired) {
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const { data: due } = await admin
    .from("subscriptions")
    .select("id, user_id, trial_end, plan_name")
    .eq("status", "trialing")
    .eq("trial_reminder_sent", false)
    .gt("trial_end", now.toISOString())
    .lte("trial_end", in48h.toISOString());

  const dueRows = due ?? [];

  // One batched RPC for all recipient emails (Prompt 15) — no per-user
  // auth admin call inside the loop.
  const emails = await getUserEmails(admin, dueRows.map((r) => r.user_id));

  // MW-V11: the user's stored timezone, so the charge date and the "today /
  // tomorrow / in N days" subject are computed in the zone the user lives in
  // rather than the server's UTC. Missing or invalid zones fall back to UTC —
  // the same behaviour as before, just no longer the default for everyone.
  const tzByUser = new Map<string, string>();
  if (dueRows.length) {
    const { data: profiles } = await admin
      .from("wellbeing_profiles")
      .select("user_id, timezone")
      .in("user_id", dueRows.map((r) => r.user_id));
    for (const prof of profiles ?? []) {
      if (isValidTimeZone(prof.timezone)) tzByUser.set(prof.user_id, prof.timezone);
    }
  }

  let sent = 0;
  for (const row of dueRows) {
    const email = emails.get(row.user_id);
    if (!email) continue;

    const tz = tzByUser.get(row.user_id) ?? "UTC";
    const trialEnd = new Date(row.trial_end);
    const daysUntilEnd = localCalendarDaysUntil(tz, trialEnd, now);

    // Exact charge disclosure (Prompt 19): "You'll be charged [PRICE] on
    // [DATE] for [PLAN] unless you cancel before then."
    const tier = row.plan_name === "pro_yearly" ? PRICING.yearly : PRICING.monthly;
    const { subject, html } = trialEndingEmail(
      {
        plan: tier.name,
        price: tier.price,
        date: trialEnd.toLocaleDateString("en-GB", {
          timeZone: tz,
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      },
      daysUntilEnd
    );
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

  await lease.release();
  return NextResponse.json({ ok: true, considered: dueRows.length, sent });
}
