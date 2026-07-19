import {
  isValidTimeZone,
  localDateFor,
  localMinutesFor,
  instantForLocalTime,
} from "@/lib/dates/local-day";

/**
 * Pure planning half of the daily-reminder job (Launch v6, Prompt 15).
 * Decides, per profile, whether to send now / schedule for later / skip —
 * with no I/O, so 10k profiles plan in milliseconds and are fully testable.
 */

export interface ReminderProfile {
  user_id: string;
  reminder_time: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
  last_reminder_sent_date: string | null;
  /** MW-S08: one-tap pause — no sends while true. */
  reminders_paused?: boolean | null;
  /** MW-S08: "skip today" — no send on this local date. */
  reminder_skip_date?: string | null;
}

export interface PlannedReminder {
  userId: string;
  localDate: string;
  /** UTC instant for provider-side scheduled send; undefined = send now. */
  scheduledAt?: string;
}

export interface ReminderPlan {
  toDeliver: PlannedReminder[];
  invalidTimezones: number;
  alreadySent: number;
  inQuietHours: number;
  /** MW-S08: paused or skip-today profiles — user controls beat schedules. */
  pausedOrSkipped: number;
}

export function planReminders(
  profiles: ReminderProfile[],
  now: Date = new Date()
): ReminderPlan {
  const plan: ReminderPlan = {
    toDeliver: [],
    invalidTimezones: 0,
    alreadySent: 0,
    inQuietHours: 0,
    pausedOrSkipped: 0,
  };

  // Intl timezone math is expensive; users cluster into a handful of zones,
  // so memoize per timezone for this fixed `now` (10k profiles → ms).
  const tzCache = new Map<string, { valid: boolean; localDate: string; localMinutes: number }>();
  const tzInfo = (tz: string) => {
    let info = tzCache.get(tz);
    if (!info) {
      info = isValidTimeZone(tz)
        ? { valid: true, localDate: localDateFor(tz, now), localMinutes: localMinutesFor(tz, now) }
        : { valid: false, localDate: "", localMinutes: 0 };
      tzCache.set(tz, info);
    }
    return info;
  };

  for (const p of profiles) {
    const tz = p.timezone || "UTC";
    const { valid, localDate, localMinutes } = tzInfo(tz);
    if (!valid) {
      plan.invalidTimezones += 1; // repaired in-app; never mis-time an email
      continue;
    }

    // MW-S08: pause and skip-today take effect before the next send, always.
    if (p.reminders_paused || p.reminder_skip_date === localDate) {
      plan.pausedOrSkipped += 1;
      continue;
    }

    if (p.last_reminder_sent_date === localDate) {
      plan.alreadySent += 1;
      continue;
    }

    let scheduledAt: string | undefined;
    const remMinutes = toMinutes(p.reminder_time);
    if (remMinutes !== null && remMinutes > localMinutes) {
      scheduledAt = instantForLocalTime(
        tz,
        localDate,
        (p.reminder_time as string).slice(0, 5)
      ).toISOString();
    } else if (inQuietHours(localMinutes, p.quiet_hours_start, p.quiet_hours_end)) {
      plan.inQuietHours += 1;
      continue;
    }

    plan.toDeliver.push({ userId: p.user_id, localDate, scheduledAt });
  }

  return plan;
}

export function toMinutes(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Quiet window may wrap midnight (e.g. 21:00 → 07:00). */
export function inQuietHours(
  minutes: number,
  start: string | null,
  end: string | null
): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null || s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** Splits ids into RPC-sized chunks (one get_user_emails call per chunk). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
