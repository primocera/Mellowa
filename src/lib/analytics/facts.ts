import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MW-V18-05: durable, full-history cohort facts, read server-side.
 *
 * These replace the previous practice of deriving activation from a rolling
 * 30-day app_events slice. Both readers FAIL CLOSED: an unavailable read is
 * reported as `available: false`, never as an empty result that a caller could
 * mistake for "no staff to exclude" or "nobody activated".
 */

export interface ExclusionRegistry {
  /** Staff/test/demo user ids to remove from every cohort denominator. */
  ids: string[];
  /**
   * False when the registry could not be read. The caller must surface this as
   * a data-quality warning rather than reporting cohorts as if no exclusions
   * exist — an unreadable registry could otherwise let staff inflate metrics.
   */
  available: boolean;
}

/** Read the server-owned staff/test/demo exclusion registry. */
export async function readExclusionRegistry(
  admin: SupabaseClient
): Promise<ExclusionRegistry> {
  const { data, error } = await admin
    .from("analytics_excluded_users")
    .select("user_id");
  if (error || !data) {
    // Fail closed: we do not know who to exclude, so say so.
    return { ids: [], available: false };
  }
  const ids = data
    .map((r) => (r as { user_id: string | null }).user_id)
    .filter((id): id is string => Boolean(id));
  return { ids, available: true };
}

export interface CanonicalActivation {
  /** user id -> immutable first-check-in instant (ISO), from full history. */
  activatedAtByUser: Record<string, string>;
  /** True only when the activation fact source was read successfully. */
  available: boolean;
}

/**
 * Read the canonical activation fact (first check-in per user) across FULL
 * history from analytics_activation_facts. Unlike an event-window derivation,
 * this counts a user who activated before the reporting window opened.
 */
export async function readCanonicalActivation(
  admin: SupabaseClient
): Promise<CanonicalActivation> {
  const { data, error } = await admin
    .from("analytics_activation_facts")
    .select("user_id, activated_at");
  if (error || !data) {
    return { activatedAtByUser: {}, available: false };
  }
  const activatedAtByUser: Record<string, string> = {};
  for (const r of data as { user_id: string | null; activated_at: string | null }[]) {
    if (r.user_id && r.activated_at) activatedAtByUser[r.user_id] = r.activated_at;
  }
  return { activatedAtByUser, available: true };
}

/**
 * Full-history distinct local check-in days per user, for exact D-N return.
 * Sourced from daily_checkins (durable), not the analytics window. Returns the
 * local calendar day for each check-in using the user's timezone; check-ins for
 * an unknown timezone fall back to UTC (documented in the cohort module).
 */
export interface CheckinDays {
  daysByUser: Record<string, string[]>;
  available: boolean;
}

export async function readCheckinDays(
  admin: SupabaseClient,
  localDay: (iso: string, timeZone: string) => string | null,
  timezoneByUser: Record<string, string>
): Promise<CheckinDays> {
  const { data, error } = await admin
    .from("daily_checkins")
    .select("user_id, created_at");
  if (error || !data) return { daysByUser: {}, available: false };
  const daysByUser: Record<string, string[]> = {};
  for (const r of data as { user_id: string | null; created_at: string | null }[]) {
    if (!r.user_id || !r.created_at) continue;
    const tz = timezoneByUser[r.user_id] ?? "UTC";
    const day = localDay(r.created_at, tz);
    if (!day) continue;
    (daysByUser[r.user_id] ??= []).push(day);
  }
  return { daysByUser, available: true };
}
