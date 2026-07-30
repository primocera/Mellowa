/**
 * Timezone-aware local-day service (Prompt 9, audit v5). Pure module — the
 * single place that turns "now" into a user's local date. Plans, check-ins,
 * progress, weekly boundaries and reminders must all use this instead of
 * UTC-ish workarounds.
 */

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The user's local calendar date (YYYY-MM-DD) for a given instant. */
export function localDateFor(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Whole calendar days from `now`'s local date to `target`'s local date, both
 * resolved in `tz`. 0 = same local day ("today"), 1 = the next local day
 * ("tomorrow"), negative = already past. Compares local calendar dates rather
 * than raw millisecond gaps, so a trial ending 20h from now that lands on the
 * next local date is honestly "tomorrow", not "today".
 */
export function localCalendarDaysUntil(
  tz: string,
  target: Date,
  now: Date = new Date()
): number {
  // localDateFor returns YYYY-MM-DD; Date.parse reads that as UTC midnight, so
  // the difference is a clean count of whole days free of any offset drift.
  const from = Date.parse(localDateFor(tz, now));
  const to = Date.parse(localDateFor(tz, target));
  return Math.round((to - from) / 86_400_000);
}

/** Minutes since local midnight for a given instant. */
export function localMinutesFor(tz: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  // Intl can render midnight as "24" in some environments.
  return (get("hour") % 24) * 60 + get("minute");
}

/**
 * Converts a local wall-clock time (in the given timezone, on the given
 * local date) to the UTC instant it occurs. Two-pass correction handles DST
 * transitions; non-existent times resolve to the shifted instant.
 */
export function instantForLocalTime(
  tz: string,
  dateStr: string,
  hhmm: string
): Date {
  const target = `${dateStr}T${hhmm}`;
  let guess = new Date(`${target}:00Z`);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(guess);
    const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
    const rendered = `${get("year")}-${get("month")}-${get("day")}T${String(
      Number(get("hour")) % 24
    ).padStart(2, "0")}:${get("minute")}`;
    const diff = Date.parse(`${target}:00Z`) - Date.parse(`${rendered}:00Z`);
    if (!diff) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

/**
 * Resolves the date a plan/check-in belongs to. Prefers the user's stored
 * IANA timezone (server-side truth); falls back to a client-supplied date
 * only when no valid timezone exists, and only within ±1 day of server time.
 */
export function resolvePlanDate(args: {
  storedTimezone: string | null | undefined;
  clientDate?: string | null;
  now?: Date;
}): string {
  const now = args.now ?? new Date();
  if (isValidTimeZone(args.storedTimezone)) {
    return localDateFor(args.storedTimezone, now);
  }
  const serverToday = now.toISOString().slice(0, 10);
  if (args.clientDate && /^\d{4}-\d{2}-\d{2}$/.test(args.clientDate)) {
    const diffDays = Math.abs(
      (Date.parse(args.clientDate) - Date.parse(serverToday)) / 86_400_000
    );
    if (diffDays <= 1) return args.clientDate;
  }
  return serverToday;
}
