import { localDate } from "@/lib/analytics/cohort";

/**
 * MW-V18-11: timezone-safe weekly reflection window + maturity.
 *
 * The reflection is about the PREVIOUS completed week. Two rules the pack
 * insists on:
 *  - Week boundaries are in the USER's timezone (DST-correct), not UTC.
 *  - A week is never shown as "missed" before it has fully elapsed — an
 *    in-progress week is PENDING, not a failure.
 *
 * Pure module (timezone + injected clock) so every boundary and maturity case
 * is fixture-testable across DST.
 */

/** ISO weekday: Monday = 1 … Sunday = 7, for a YYYY-MM-DD local date. */
function isoWeekday(localYmd: string): number {
  const t = Date.parse(`${localYmd}T00:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0=Sun..6=Sat (date is fixed at UTC midnight)
  return dow === 0 ? 7 : dow;
}

function addDaysYmd(localYmd: string, n: number): string {
  const t = Date.parse(`${localYmd}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The local Monday (YYYY-MM-DD) that starts the week containing `iso` in
 * `timeZone`. Weeks start on Monday, matching the reflection's week_start.
 */
export function weekStartFor(iso: string, timeZone: string): string | null {
  const day = localDate(iso, timeZone);
  if (!day) return null;
  return addDaysYmd(day, -(isoWeekday(day) - 1));
}

export type ReflectionState = "pending" | "available" | "completed";

export interface ReflectionWindow {
  /** Local Monday of the week currently in progress. */
  currentWeekStart: string;
  /** Local Monday of the week the reflection is about (the previous week). */
  reflectionWeekStart: string;
  /**
   * True once the reflection week has fully elapsed locally (the current week
   * has begun). Until then the reflection is not yet due.
   */
  reflectionWeekMature: boolean;
}

/** Compute the reflection window for a user at `now` in `timeZone`. */
export function reflectionWindow(now: Date, timeZone: string): ReflectionWindow | null {
  const currentWeekStart = weekStartFor(now.toISOString(), timeZone);
  if (!currentWeekStart) return null;
  const reflectionWeekStart = addDaysYmd(currentWeekStart, -7);
  // The previous week is mature the moment the current week has started, which
  // is always true here (we are inside currentWeekStart's week).
  return { currentWeekStart, reflectionWeekStart, reflectionWeekMature: true };
}

/**
 * The reflection state for a SPECIFIC week the UI wants to show.
 *  - completed: a reflection row exists for that week.
 *  - pending:   the week has NOT fully elapsed yet (in progress) — never "missed".
 *  - available: the week has elapsed and no reflection exists yet.
 */
export function reflectionStateForWeek(
  weekStart: string,
  now: Date,
  timeZone: string,
  hasReflection: boolean
): ReflectionState {
  if (hasReflection) return "completed";
  const currentWeekStart = weekStartFor(now.toISOString(), timeZone);
  if (!currentWeekStart) return "pending";
  // The week is mature (available) only once a later week has started locally.
  return weekStart < currentWeekStart ? "available" : "pending";
}

// --- carry-forward provenance ------------------------------------------------

export type CarryForwardDecision = "accepted" | "edited" | "rejected";

export interface CarryForwardItem<T = string> {
  /** Closed-set suggestion key (e.g. a "keep" value or a constraint code). */
  suggestion: T;
  decision: CarryForwardDecision;
  /** For an edited decision, the user's chosen closed-set value. */
  editedTo?: T;
  /** Where the suggestion came from, for transparency (see M12). */
  source: "last_week" | "learned_preference" | "default";
}

/**
 * Resolve what actually carries into next week from the user's explicit
 * decisions. Rejected suggestions carry nothing; edited ones carry the edit;
 * accepted ones carry the suggestion. Nothing is carried without an explicit
 * accept/edit — silence never becomes a preference.
 */
export function resolveCarryForward<T>(items: CarryForwardItem<T>[]): T[] {
  const out: T[] = [];
  for (const it of items) {
    if (it.decision === "accepted") out.push(it.suggestion);
    else if (it.decision === "edited" && it.editedTo !== undefined) out.push(it.editedTo);
    // rejected → nothing
  }
  return out;
}
