import type { AppEvent } from "@/lib/analytics/taxonomy";

/**
 * MW-V18-09: canonical first-session milestones.
 *
 * The pack's headline instrumentation requirement — the milestones a first
 * session is judged by, computed ONLY from server-authoritative events so a
 * screen view can never be mistaken for value:
 *
 *   onboarding_completed → first_checkin → plan_created →
 *   first_meaningful_action → first_value
 *
 * Definitions (the point of the module):
 * - plan_created         = a plan actually exists (generated, sample or the
 *                          deterministic fallback), not that a spinner showed.
 * - first_meaningful_action = the first DURABLE interaction with the plan:
 *                          completing an item, reshaping the day, or doing the
 *                          sample value action. A view/deferral does NOT count.
 * - first_value          = the first durable proof the product delivered value:
 *                          a COMPLETED plan action (or the sample value action).
 *                          Explicitly not `now_viewed`/`sample_plan_opened` —
 *                          "first_value is a durable action, not a screen view."
 *
 * Pure module (events + injected clock) so the funnel and the session-window
 * metric are fully fixture-testable.
 */

export interface SessionEvent {
  event: string;
  created_at: string;
}

/** Durable engagement with the plan (completing, reshaping, or sample value). */
export const MEANINGFUL_ACTION_EVENTS: AppEvent[] = [
  "now_action_done",
  "plan_repair_completed",
  "sample_value_action_completed",
];

/** Durable value delivered — a completed action, never a mere view. */
export const VALUE_EVENTS: AppEvent[] = ["now_action_done", "sample_value_action_completed"];

/** Any event that proves a plan exists to act on. */
const PLAN_CREATED_EVENTS: AppEvent[] = [
  "plan_generated",
  "sample_plan_generated",
  "plan_fallback_served",
];

export interface FirstSessionMilestones {
  onboardingCompletedAt: string | null;
  firstCheckinAt: string | null;
  planCreatedAt: string | null;
  firstMeaningfulActionAt: string | null;
  firstValueAt: string | null;
}

/** Earliest timestamp among events whose name is in `names`, or null. */
function earliest(events: SessionEvent[], names: readonly string[]): string | null {
  const set = new Set(names);
  let best: number | null = null;
  let bestIso: string | null = null;
  for (const e of events) {
    if (!set.has(e.event)) continue;
    const t = Date.parse(e.created_at);
    if (!Number.isFinite(t)) continue;
    if (best === null || t < best) {
      best = t;
      bestIso = e.created_at;
    }
  }
  return bestIso;
}

export function firstSessionMilestones(events: SessionEvent[]): FirstSessionMilestones {
  return {
    onboardingCompletedAt: earliest(events, ["onboarding_completed"]),
    firstCheckinAt: earliest(events, ["checkin_completed"]),
    planCreatedAt: earliest(events, PLAN_CREATED_EVENTS),
    firstMeaningfulActionAt: earliest(events, MEANINGFUL_ACTION_EVENTS),
    firstValueAt: earliest(events, VALUE_EVENTS),
  };
}

export interface FirstSessionFunnelStep {
  milestone: keyof FirstSessionMilestones;
  reached: boolean;
  at: string | null;
}

/** Ordered funnel for the first-session scorecard. */
export function firstSessionFunnel(events: SessionEvent[]): FirstSessionFunnelStep[] {
  const m = firstSessionMilestones(events);
  const order: (keyof FirstSessionMilestones)[] = [
    "onboardingCompletedAt",
    "firstCheckinAt",
    "planCreatedAt",
    "firstMeaningfulActionAt",
    "firstValueAt",
  ];
  return order.map((k) => ({ milestone: k, reached: m[k] !== null, at: m[k] }));
}

export const DEFAULT_SESSION_WINDOW_MIN = 30;

/**
 * The primary experiment metric: did the user reach first_value within the first
 * session? The session starts at their earliest milestone (onboarding/check-in)
 * and lasts `windowMin` minutes. Returns:
 *  - reached: first_value happened inside the window
 *  - pending: the window has not yet elapsed AND no value yet (not a failure)
 *  - false otherwise.
 */
export function reachedFirstValueInSession(
  events: SessionEvent[],
  now: Date,
  windowMin = DEFAULT_SESSION_WINDOW_MIN
): { reached: boolean; pending: boolean } {
  const m = firstSessionMilestones(events);
  const startIso = m.onboardingCompletedAt ?? m.firstCheckinAt ?? m.planCreatedAt;
  if (!startIso) return { reached: false, pending: false };
  const start = Date.parse(startIso);
  const windowMs = windowMin * 60_000;
  const deadline = start + windowMs;

  if (m.firstValueAt) {
    const v = Date.parse(m.firstValueAt);
    if (Number.isFinite(v) && v <= deadline) return { reached: true, pending: false };
    // Value came, but after the session window closed — not a first-session win.
    return { reached: false, pending: false };
  }
  // No value yet: pending while the window is still open (never a silent miss).
  return { reached: false, pending: now.getTime() < deadline };
}
