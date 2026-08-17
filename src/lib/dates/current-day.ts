import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidTimeZone, resolvePlanDate } from "./local-day";

/**
 * Shared, fail-closed current-local-day resolver (MW-01 / MW-03).
 *
 * The single server-side authority that turns "now" into the authenticated
 * user's local calendar date, and — crucially — distinguishes three states so
 * an outage can never be silently laundered into a wrong UTC day:
 *
 *   - `resolved`            we know the user's local day (from a valid stored
 *                           IANA timezone, or the documented client/server
 *                           fallback when the profile timezone is genuinely
 *                           absent or invalid);
 *   - `missing_or_invalid`  the profile row was read successfully but has no
 *                           usable timezone — a *resolved* day via the safe
 *                           fallback, flagged so callers can log/telemeter it;
 *   - `unavailable`         the timezone read itself FAILED (transport,
 *                           permission, timeout). Callers MUST fail closed
 *                           (503) and must not mutate or emit analytics.
 *
 * `resolved` and `missing_or_invalid` both carry a usable `day`; only
 * `unavailable` withholds it. This is the guard MW-01 uses to reject stale-day
 * completions and MW-03 uses across the weekly surface.
 */
export type CurrentDayResolution =
  | {
      status: "resolved" | "missing_or_invalid";
      day: string;
      timeZone: string | null;
      source: "timezone" | "client" | "server";
    }
  | { status: "unavailable" };

/** True when the day is known (either a valid tz or a safe fallback). */
export function hasDay(
  r: CurrentDayResolution
): r is Extract<CurrentDayResolution, { day: string }> {
  return r.status === "resolved" || r.status === "missing_or_invalid";
}

export async function resolveCurrentDay(
  supabase: SupabaseClient,
  userId: string,
  opts: { clientDate?: string | null; now?: Date } = {}
): Promise<CurrentDayResolution> {
  const { data, error } = await supabase
    .from("wellbeing_profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();

  // A genuine read failure — never fall back to UTC and mutate the wrong day.
  if (error) return { status: "unavailable" };

  const now = opts.now ?? new Date();
  const tz = data?.timezone ?? null;

  if (isValidTimeZone(tz)) {
    return {
      status: "resolved",
      day: resolvePlanDate({ storedTimezone: tz, now }),
      timeZone: tz,
      source: "timezone",
    };
  }

  // Profile read succeeded but timezone is absent/invalid → documented safe
  // fallback (bounded client date, else server date). Distinct from an outage.
  const day = resolvePlanDate({
    storedTimezone: null,
    clientDate: opts.clientDate ?? null,
    now,
  });
  const serverToday = now.toISOString().slice(0, 10);
  return {
    status: "missing_or_invalid",
    day,
    timeZone: null,
    source: day === serverToday ? "server" : "client",
  };
}
