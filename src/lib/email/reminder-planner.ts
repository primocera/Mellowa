import {
  isValidTimeZone,
  localDateFor,
  localMinutesFor,
  instantForLocalTime,
} from "@/lib/dates/local-day";

/**
 * Pure planning half of the daily-reminder job (Launch v6, Prompt 15;
 * extended in MW-V10-05 to be the ONE place a reminder decision is made).
 *
 * Every reason a reminder must not be sent lives here, in one ordered pass, so
 * a caller cannot accidentally implement half the rules. No I/O, so 10k
 * profiles plan in milliseconds and every rule is unit-testable.
 *
 * The order of the checks is deliberate and load-bearing — see `planReminders`.
 */

/**
 * Version of the reminder consent copy shown before opting in (MW-S08).
 *
 * MW-V10-05: this was previously declared inside the settings form and read by
 * nobody, so consent could not actually be enforced. It now lives here — the
 * one module that decides whether to send — and the form imports it. The value
 * is unchanged on purpose: bumping it would invalidate the consent of every
 * user who has already opted in, silently turning their reminders off. Bump it
 * only when the copy changes materially, and expect exactly that consequence.
 */
export const REMINDER_CONSENT_VERSION = "2026-07";

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
  /**
   * MW-V10-05: the consent version the user actually agreed to. A profile
   * carrying an older version has consented to different copy, so it is not
   * consent for what we would send now.
   */
  reminder_consent_version?: string | null;
  /**
   * MW-V10-05: canonical Stripe status. A reminder tells the user to open the
   * app and make a plan; for someone who cannot generate one, that is an
   * upsell wearing a wellbeing costume.
   */
  subscription_status?: string | null;
  /**
   * MW-V10-05: true when this user has a recent crisis/eating-disorder safety
   * signal. Never send an activity nudge to someone in that state.
   */
  safety_suppressed?: boolean | null;
}

export interface PlannedReminder {
  userId: string;
  localDate: string;
  /** UTC instant for provider-side scheduled send; undefined = send now. */
  scheduledAt?: string;
  /**
   * MW-V10-05: the planner owns the dedupe key. Building it at the call site
   * meant every caller had to remember the same shape; a divergent key is a
   * duplicate email.
   */
  dedupeKey: string;
}

/** Why a profile was not planned. Counts only — never a user id in a log. */
export interface ReminderSkips {
  invalidTimezones: number;
  alreadySent: number;
  inQuietHours: number;
  /** Paused or skip-today — user controls beat schedules. */
  pausedOrSkipped: number;
  /** Consent was given for an older version of the reminder copy. */
  staleConsent: number;
  /** Billing state means the nudge would lead to a paywall, not a plan. */
  billingState: number;
  /** A recent safety signal suppresses activity nudges entirely. */
  safetySuppressed: number;
}

export interface ReminderPlan extends ReminderSkips {
  toDeliver: PlannedReminder[];
}

/**
 * Statuses for which a "come and make a plan" nudge is honest. `past_due`,
 * `unpaid` and `canceled` keep read access but cannot generate, so nudging them
 * to check in would land on a paywall — the billing-recovery banner is their
 * route, not an email. `none`/`incomplete` are pre-trial users who still have
 * their free sample day available.
 */
const NUDGEABLE_STATUSES = new Set([
  "trialing",
  "active",
  "none",
  "incomplete",
]);

export function canNudgeForBillingState(status: string | null | undefined): boolean {
  // An unknown/absent status is a user who never started billing at all.
  return NUDGEABLE_STATUSES.has((status ?? "none").trim() || "none");
}

/** The dedupe key for one user's reminder on one local date. */
export function reminderDedupeKey(userId: string, localDate: string): string {
  return `daily_reminder:${userId}:${localDate}`;
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
    staleConsent: 0,
    billingState: 0,
    safetySuppressed: 0,
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
    // 1. Safety first, before anything else can decide to send. A person with a
    //    recent crisis signal gets no activity nudge, whatever their settings
    //    say — and this check must not be reachable around.
    if (p.safety_suppressed) {
      plan.safetySuppressed += 1;
      continue;
    }

    // 2. Consent. Opting in to older copy is not consent for current copy.
    //    A missing version predates versioning and is treated as stale rather
    //    than assumed valid — failing closed on consent is the safe direction.
    if (p.reminder_consent_version !== REMINDER_CONSENT_VERSION) {
      plan.staleConsent += 1;
      continue;
    }

    // 3. Billing state: never nudge someone toward a paywall.
    if (!canNudgeForBillingState(p.subscription_status)) {
      plan.billingState += 1;
      continue;
    }

    const tz = p.timezone || "UTC";
    const { valid, localDate, localMinutes } = tzInfo(tz);
    if (!valid) {
      plan.invalidTimezones += 1; // repaired in-app; never mis-time an email
      continue;
    }

    // 4. MW-S08: pause and skip-today take effect before the next send, always.
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
      // instantForLocalTime resolves the local wall-clock time against the
      // zone's offset ON THAT DATE, so a DST shift moves the UTC instant rather
      // than the user's experienced time.
      scheduledAt = instantForLocalTime(
        tz,
        localDate,
        (p.reminder_time as string).slice(0, 5)
      ).toISOString();
    } else if (inQuietHours(localMinutes, p.quiet_hours_start, p.quiet_hours_end)) {
      plan.inQuietHours += 1;
      continue;
    }

    plan.toDeliver.push({
      userId: p.user_id,
      localDate,
      scheduledAt,
      dedupeKey: reminderDedupeKey(p.user_id, localDate),
    });
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

// --- Honest timing disclosure -------------------------------------------------

/**
 * MW-V10-05: what we can actually promise about delivery time.
 *
 * The truth: Vercel Hobby cron guarantees one daily invocation, not a
 * to-the-minute scheduler. When the run happens BEFORE the user's chosen time,
 * the send is handed to the provider as a scheduled send and lands close to it.
 * When the run happens after, the reminder goes out on that run instead — later
 * than chosen, never earlier, and never twice.
 *
 * So the setting is a preference, not a guarantee, and the UI has to say so.
 * Claiming a minute we cannot hit is the kind of small dishonesty that makes a
 * user distrust everything else the app tells them.
 */
export const REMINDER_TIMING_DISCLOSURE =
  "Reminders aim for your chosen time and never arrive before it. On some days they arrive later in the day — we send at most one, on days you haven't made a plan yet.";
