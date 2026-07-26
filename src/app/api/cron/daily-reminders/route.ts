import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";
import { deliverEmail } from "@/lib/email/deliver";
import { getUserEmails } from "@/lib/email/recipients";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";
import { planReminders, type ReminderProfile } from "@/lib/email/reminder-planner";
import { acquireCronLease } from "@/lib/cron-lease";
import { onboardingNudgeEmail } from "@/lib/email/templates";

/**
 * Daily reminder cron (v6 Prompts 9/12/15) — opt-in daily reminder email.
 *
 * Scale-safe: profiles are scanned with keyset pagination (batches of
 * BATCH_SIZE, bounded by a time budget), recipient emails are fetched in one
 * RPC per batch (no per-user auth admin call), and delivery is idempotent via
 * the email ledger's unique event key plus last_reminder_sent_date. A run cut
 * short by the time budget resumes naturally on the next trigger: already-sent
 * users are skipped by the planner.
 *
 * Retention pruning moved to /api/cron/retention (Prompt 15): one job's
 * failure can no longer hide the other's.
 */

const BATCH_SIZE = 200;
const TIME_BUDGET_MS = 50_000;
/** Slightly longer than the time budget, so a run cannot outlive its lease. */
const LEASE_TTL_SECONDS = 90;
/** A crisis signal within this window suppresses activity nudges entirely. */
const SAFETY_SUPPRESSION_DAYS = 30;

export async function GET(request: Request) {
  const denied = requireBearerSecret(request, serverEnv.cronSecret);
  if (denied) return denied;

  const admin = createAdminClient();
  const startedAt = Date.now();
  const now = new Date();

  // MW-V10-05: a second overlapping run is a no-op rather than a duplicate
  // scan. Duplicate SENDS were already impossible (ledger event key); this
  // stops the duplicated work and provider load. Fails open by design.
  const lease = await acquireCronLease(admin, "daily-reminders", LEASE_TTL_SECONDS);
  if (!lease.acquired) {
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }

  let cursor: string | null = null;
  let sent = 0;
  let invalidTimezones = 0;
  let scanned = 0;
  let truncated = false;
  // Aggregate skip reasons — counts only, so an ops log never carries identity.
  const skips = {
    staleConsent: 0,
    billingState: 0,
    safetySuppressed: 0,
    pausedOrSkipped: 0,
    inQuietHours: 0,
  };

  for (;;) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      truncated = true; // next trigger continues; planner dedupes
      break;
    }

    let query = admin
      .from("wellbeing_profiles")
      .select(
        "user_id, reminder_time, quiet_hours_start, quiet_hours_end, timezone, last_reminder_sent_date, reminders_paused, reminder_skip_date, reminder_consent_version"
      )
      .eq("reminders_opt_in", true)
      .not("reminder_time", "is", null)
      .order("user_id", { ascending: true })
      .limit(BATCH_SIZE);
    if (cursor) query = query.gt("user_id", cursor);

    const { data: profiles, error } = await query;
    if (error) {
      console.error("[daily-reminders] profile scan failed", { message: error.message });
      break;
    }
    if (!profiles?.length) break;
    scanned += profiles.length;
    cursor = profiles[profiles.length - 1].user_id;

    // MW-V10-05: the planner decides everything, but it is pure — the two
    // facts it cannot know are fetched here, once per batch.
    const batchIds = profiles.map((p) => p.user_id as string);
    const [{ data: subs }, { data: safetyRows }] = await Promise.all([
      admin.from("subscriptions").select("user_id, status").in("user_id", batchIds),
      // A recent crisis / eating-disorder signal suppresses activity nudges.
      // Only the user id is read — never the signal's content.
      admin
        .from("safety_events")
        .select("user_id")
        .in("user_id", batchIds)
        .gte(
          "created_at",
          new Date(now.getTime() - SAFETY_SUPPRESSION_DAYS * 86_400_000).toISOString()
        ),
    ]);
    const statusByUser = new Map(
      (subs ?? []).map((r) => [r.user_id as string, r.status as string | null])
    );
    const suppressed = new Set((safetyRows ?? []).map((r) => r.user_id as string));

    const enriched: ReminderProfile[] = (profiles as ReminderProfile[]).map((p) => ({
      ...p,
      subscription_status: statusByUser.get(p.user_id) ?? null,
      safety_suppressed: suppressed.has(p.user_id),
    }));

    const plan = planReminders(enriched, now);
    invalidTimezones += plan.invalidTimezones;
    skips.staleConsent += plan.staleConsent;
    skips.billingState += plan.billingState;
    skips.safetySuppressed += plan.safetySuppressed;
    skips.pausedOrSkipped += plan.pausedOrSkipped;
    skips.inQuietHours += plan.inQuietHours;

    // MW-S08: relevance — this reminder means "no plan created yet today".
    // Users who already made today's plan are not nudged about it.
    if (plan.toDeliver.length) {
      const { data: todaysPlans } = await admin
        .from("daily_plans")
        .select("user_id, plan_date")
        .in("user_id", plan.toDeliver.map((r) => r.userId))
        .in("plan_date", [...new Set(plan.toDeliver.map((r) => r.localDate))]);
      const hasPlan = new Set(
        (todaysPlans ?? []).map((p) => `${p.user_id}:${p.plan_date}`)
      );
      plan.toDeliver = plan.toDeliver.filter(
        (r) => !hasPlan.has(`${r.userId}:${r.localDate}`)
      );
    }

    if (plan.toDeliver.length) {
      const emails = await getUserEmails(
        admin,
        plan.toDeliver.map((r) => r.userId)
      );
      const deliveredUserIds: string[] = [];
      let deliveredLocalDate = "";

      for (const r of plan.toDeliver) {
        const email = emails.get(r.userId);
        if (!email) continue;

        // Opt-out must work from the email itself, signed out, on a phone.
        const optOut = unsubscribeUrl(r.userId, "daily_reminder");

        const result = await deliverEmail({
          eventKey: r.dedupeKey,
          userId: r.userId,
          template: "daily_reminder",
          to: email,
          scheduledAt: r.scheduledAt,
          unsubscribeUrl: optOut,
          subject: "A gentle nudge from Mellowa",
          html: `<div style="font-family:sans-serif;color:#1F2937;line-height:1.6">
            <p>Hi,</p>
            <p>Just a soft reminder — whenever you have a minute, a quick check-in
            can shape a plan that actually fits today.</p>
            <p><a href="${serverEnv.appUrl}/check-in?from=reminder" style="color:#6D8C7D">Open Mellowa</a></p>
            <p style="color:#6B7280;font-size:13px">No pressure — skipping days is
            part of it.${
              optOut
                ? ` <a href="${optOut}" style="color:#6B7280">Turn these reminders off</a>.`
                : " You can turn these reminders off any time in Settings."
            }</p>
          </div>`,
        });

        // Only record the local date after real delivery. Duplicate protection
        // within a day comes from the ledger's unique event key, so an
        // unconfigured provider stays retryable without ever double-sending.
        if (result.sent || result.status === "duplicate") {
          deliveredUserIds.push(r.userId);
          deliveredLocalDate = r.localDate;
        }
        if (result.sent) sent += 1;
      }

      // One batched update per page instead of one per user. Users in a batch
      // share dates except across timezone boundaries; group to stay correct.
      if (deliveredUserIds.length) {
        const byDate = new Map<string, string[]>();
        for (const r of plan.toDeliver) {
          if (deliveredUserIds.includes(r.userId)) {
            const list = byDate.get(r.localDate) ?? [];
            list.push(r.userId);
            byDate.set(r.localDate, list);
          }
        }
        for (const [localDate, ids] of byDate) {
          await admin
            .from("wellbeing_profiles")
            .update({ last_reminder_sent_date: localDate })
            .in("user_id", ids);
        }
        void deliveredLocalDate;
      }
    }

    if (profiles.length < BATCH_SIZE) break;
  }

  // One-time onboarding nudge (Prompt 19): accounts 1–14 days old with no
  // wellbeing profile yet. Strictly once per user via the ledger event key;
  // suppressed automatically once a profile exists or the account is deleted.
  let nudged = 0;
  if (!truncated) {
    const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 3600_000).toISOString();
    const { data: recent } = await admin
      .from("profiles")
      .select("id")
      .gte("created_at", twoWeeksAgo)
      .lte("created_at", dayAgo)
      .limit(500);
    const ids = (recent ?? []).map((r) => r.id as string);
    if (ids.length) {
      const { data: withProfile } = await admin
        .from("wellbeing_profiles")
        .select("user_id")
        .in("user_id", ids);
      const done = new Set((withProfile ?? []).map((r) => r.user_id as string));
      const pending = ids.filter((id) => !done.has(id));
      const emails = await getUserEmails(admin, pending);
      for (const userId of pending) {
        const email = emails.get(userId);
        if (!email) continue;
        const optOut = unsubscribeUrl(userId, "onboarding_nudge");
        const { subject, html } = onboardingNudgeEmail(optOut);
        const result = await deliverEmail({
          eventKey: `onboarding_nudge:${userId}`,
          userId,
          template: "onboarding_nudge",
          to: email,
          unsubscribeUrl: optOut,
          subject,
          html,
        });
        if (result.sent) nudged += 1;
      }
    }
  }

  await lease.release();

  return NextResponse.json({
    ok: true,
    sent,
    nudged,
    scanned,
    invalid_timezones: invalidTimezones,
    // Categories only — an ops response never carries a user id.
    skipped: skips,
    truncated,
  });
}
