import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";
import { pruneExpiredData } from "@/lib/privacy/retention";
import { deliverEmail } from "@/lib/email/deliver";
import {
  isValidTimeZone,
  localDateFor,
  localMinutesFor,
  instantForLocalTime,
} from "@/lib/dates/local-day";

/**
 * Daily cron (Prompts 9 + 12) — opt-in daily reminder email.
 *
 * Vercel Hobby allows only one cron run per day, so exact-time delivery is
 * handed to Resend scheduled sending: the run computes each user's local
 * reminder_time as a UTC instant and schedules the email for it (or sends
 * immediately when the time already passed and we're outside quiet hours).
 * Users with an invalid timezone are skipped and counted — the app shows
 * them a repair prompt (TimezoneRepair) rather than failing silently.
 */
export async function GET(request: Request) {
  const denied = requireBearerSecret(request, serverEnv.cronSecret);
  if (denied) return denied;

  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("wellbeing_profiles")
    .select(
      "user_id, reminder_time, quiet_hours_start, quiet_hours_end, timezone, last_reminder_sent_date"
    )
    .eq("reminders_opt_in", true)
    .not("reminder_time", "is", null);

  let sent = 0;
  let invalidTimezones = 0;
  for (const p of profiles ?? []) {
    const tz = p.timezone || "UTC";
    if (!isValidTimeZone(tz)) {
      invalidTimezones += 1;
      continue; // repair prompt in-app; never mis-time an email
    }
    const now = new Date();
    const localDate = localDateFor(tz, now);
    const localMinutes = localMinutesFor(tz, now);

    if (p.last_reminder_sent_date === localDate) continue;

    // Preferred reminder time still ahead today → schedule with the provider.
    let scheduledAt: string | undefined;
    const remMinutes = toMinutes(p.reminder_time);
    if (remMinutes !== null && remMinutes > localMinutes) {
      scheduledAt = instantForLocalTime(
        tz,
        localDate,
        p.reminder_time.slice(0, 5)
      ).toISOString();
    } else if (inQuietHours(localMinutes, p.quiet_hours_start, p.quiet_hours_end)) {
      // Time already passed and we're inside quiet hours — skip today.
      continue;
    }

    const { data: userData } = await admin.auth.admin.getUserById(p.user_id);
    const email = userData.user?.email;
    if (!email) continue;

    const result = await deliverEmail({
      eventKey: `daily_reminder:${p.user_id}:${localDate}`,
      userId: p.user_id,
      template: "daily_reminder",
      to: email,
      scheduledAt,
      subject: "A gentle nudge from Mellowa",
      html: `<div style="font-family:sans-serif;color:#1F2937;line-height:1.6">
        <p>Hi,</p>
        <p>Just a soft reminder — whenever you have a minute, a quick check-in
        can shape a plan that actually fits today.</p>
        <p><a href="${serverEnv.appUrl}/check-in" style="color:#6D8C7D">Open Mellowa</a></p>
        <p style="color:#6B7280;font-size:13px">No pressure — skipping days is
        part of it. You can turn these reminders off any time in Settings.</p>
      </div>`,
    });

    // Only record the local date after real delivery. Duplicate protection
    // within a day comes from the delivery ledger's unique event key, so an
    // unconfigured provider stays retryable without ever double-sending.
    if (result.sent || result.status === "duplicate") {
      await admin
        .from("wellbeing_profiles")
        .update({ last_reminder_sent_date: localDate })
        .eq("user_id", p.user_id);
    }
    if (result.sent) sent += 1;
  }

  // Data-retention pruning piggybacks on the daily run (Prompt 4).
  const pruned = await pruneExpiredData();

  return NextResponse.json({
    ok: true,
    sent,
    invalid_timezones: invalidTimezones,
    pruned,
  });
}

function toMinutes(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Quiet window may wrap midnight (e.g. 21:00 → 07:00). */
function inQuietHours(
  minutes: number,
  start: string | null,
  end: string | null
): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null || s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}
