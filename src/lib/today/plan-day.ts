import { localDate } from "@/lib/analytics/cohort";

/**
 * MW-V18-14: canonical daily-plan identity + midnight correctness.
 *
 * The identity of "today's plan" is the user's LOCAL calendar date in their
 * canonical timezone — computed server-side, never from the browser clock. A
 * wrong device clock, a stale tab or crossing a timezone must not create,
 * duplicate or mutate the wrong day. Prior days stay as immutable history; the
 * new day is loaded/created deterministically.
 *
 * Pure module (timezone + injected clock) so travel/DST/midnight are fully
 * fixture-testable.
 */

/** The canonical plan date (YYYY-MM-DD) for a user, in their timezone. */
export function planDateFor(now: Date, timeZone: string): string | null {
  return localDate(now.toISOString(), timeZone || "UTC");
}

export type PlanDayRelation = "today" | "past" | "future" | "unknown";

/**
 * Where a stored plan's date sits relative to the user's local today. The UI
 * uses this — not the browser date — to decide whether a plan is the current
 * day, historical, or (defensively) a future date that should never be edited
 * as "today".
 */
export function classifyPlanDay(
  planDate: string,
  now: Date,
  timeZone: string
): PlanDayRelation {
  const today = planDateFor(now, timeZone);
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(planDate)) return "unknown";
  if (planDate === today) return "today";
  return planDate < today ? "past" : "future";
}

/**
 * True when the loaded plan belongs to a PAST local day, so the app should load
 * or create today's plan instead. A future-dated or unknown plan never triggers
 * a rollover mutation — only genuine "the day advanced" does.
 */
export function isRolloverNeeded(
  loadedPlanDate: string | null | undefined,
  now: Date,
  timeZone: string
): boolean {
  if (!loadedPlanDate) return true; // nothing loaded → load today
  return classifyPlanDay(loadedPlanDate, now, timeZone) === "past";
}

/**
 * Stable idempotency key for a plan mutation. Duplicate clicks, a retried
 * request or two tabs firing the same action all derive the SAME key, so the
 * server can collapse them to one effect. The key is opaque and PII-free (ids
 * and a canonical action slug only).
 */
export function mutationIdempotencyKey(
  userId: string,
  planDate: string,
  action: string,
  itemKey = ""
): string {
  return `${userId}:${planDate}:${action}:${itemKey}`;
}

export type MutationConflict = "ok" | "stale" | "not_today";

/**
 * Guard a mutation against the two conflicts that matter on Today:
 *  - stale: the client's plan version is behind the server's (another tab or a
 *    prior repair advanced it) → the client must refresh, not overwrite.
 *  - not_today: the mutation targets a plan that is no longer the current local
 *    day (midnight passed, or a wrong-clock/stale-tab attempt) → reject rather
 *    than mutate a historical day.
 */
export function checkMutationAllowed(args: {
  planDate: string;
  clientVersion: number;
  serverVersion: number;
  now: Date;
  timeZone: string;
}): MutationConflict {
  if (args.clientVersion < args.serverVersion) return "stale";
  if (classifyPlanDay(args.planDate, args.now, args.timeZone) !== "today") return "not_today";
  return "ok";
}
