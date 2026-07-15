import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { sendEmail } from "@/lib/email/send";

/**
 * Hourly cron (Prompt 12) — opt-in, timezone-aware daily reminder email.
 *
 * For each profile with reminders_opt_in and a reminder_time, we compute the
 * user's LOCAL time from their stored IANA timezone. If the local hour matches
 * their chosen hour, the local time is outside their quiet hours, and we
 * haven't sent one on this local date yet, we send a gentle nudge.
 * At most one per local day (last_reminder_sent_date). Skipped silently when
 * RESEND_API_KEY is not configured.
 */
export async function GET(request: Request) {
  const secret = serverEnv.cronSecret;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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

    const target = toMinutes(p.reminder_time);
    if (target === null) continue;
    // Send within the hour that follows the chosen time.
    if (localMinutes < target || localMinutes >= target + 60) continue;

    if (inQuietHours(localMinutes, p.quiet_hours_start, p.quiet_hours_end)) {
      continue;
    }

    const { data: userData } = await admin.auth.admin.getUserById(p.user_id);
    const email = userData.user?.email;
    if (!email) continue;

    const result = await sendEmail({
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

    // Mark the local date even when the provider is unconfigured so we never
    // spam once it is configured.
    await admin
      .from("wellbeing_profiles")
      .update({ last_reminder_sent_date: localDate })
      .eq("user_id", p.user_id);
    if (result.sent) sent += 1;
  }

  return NextResponse.json({ ok: true, sent });
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
