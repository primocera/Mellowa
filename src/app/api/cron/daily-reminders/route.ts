import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";
import { pruneExpiredData } from "@/lib/privacy/retention";
import { deliverEmail } from "@/lib/email/deliver";

/**
 * Daily cron (Prompt 12) — opt-in daily reminder email.
 *
 * Vercel Hobby allows only one run per day, so exact reminder_time delivery
 * isn't possible; we send on the daily run instead, still respecting the
 * user's LOCAL quiet hours (from their stored IANA timezone) and at most one
 * email per local day (last_reminder_sent_date). If the run lands inside a
 * user's quiet hours they're skipped that day, never woken. Skipped silently
 * when RESEND_API_KEY is not configured. (On a paid plan: switch the schedule
 * back to hourly and re-enable the reminder_time window check.)
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
  for (const p of profiles ?? []) {
    const tz = p.timezone || "UTC";
    let localDate: string;
    let localMinutes: number;
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(new Date());
      const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
      localDate = `${get("year")}-${get("month")}-${get("day")}`;
      localMinutes = Number(get("hour")) * 60 + Number(get("minute"));
    } catch {
      continue; // invalid timezone — skip rather than mis-time
    }

    if (p.last_reminder_sent_date === localDate) continue;

    if (inQuietHours(localMinutes, p.quiet_hours_start, p.quiet_hours_end)) {
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

  return NextResponse.json({ ok: true, sent, pruned });
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
