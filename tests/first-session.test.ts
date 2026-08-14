import { describe, expect, it } from "vitest";
import {
  firstSessionMilestones,
  firstSessionFunnel,
  reachedFirstValueInSession,
  MEANINGFUL_ACTION_EVENTS,
  VALUE_EVENTS,
  type SessionEvent,
} from "@/lib/today/first-session";

/**
 * MW-V18-09: first-session milestones are computed from server-authoritative
 * events; first_value is a DURABLE action, never a screen view; and the
 * session-window metric reports pending (not a miss) while the window is open.
 */

const ev = (event: string, minutesAfter: number): SessionEvent => ({
  event,
  created_at: new Date(Date.parse("2026-08-14T09:00:00Z") + minutesAfter * 60_000).toISOString(),
});

describe("milestone computation", () => {
  it("derives each milestone from the earliest qualifying event", () => {
    const events = [
      ev("onboarding_completed", 0),
      ev("checkin_completed", 2),
      ev("plan_generated", 3),
      ev("now_action_done", 5),
    ];
    const m = firstSessionMilestones(events);
    expect(m.onboardingCompletedAt).toBe(events[0].created_at);
    expect(m.firstCheckinAt).toBe(events[1].created_at);
    expect(m.planCreatedAt).toBe(events[2].created_at);
    expect(m.firstMeaningfulActionAt).toBe(events[3].created_at);
    expect(m.firstValueAt).toBe(events[3].created_at);
  });

  it("plan_created counts the deterministic fallback, not just AI generation", () => {
    const m = firstSessionMilestones([ev("plan_fallback_served", 1)]);
    expect(m.planCreatedAt).not.toBeNull();
  });

  it("first_value is a durable action, NOT a screen view", () => {
    // Only views/deferrals — no value.
    const viewsOnly = firstSessionMilestones([
      ev("now_viewed", 1),
      ev("sample_plan_opened", 2),
      ev("now_action_deferred", 3),
    ]);
    expect(viewsOnly.firstValueAt).toBeNull();
    expect(viewsOnly.firstMeaningfulActionAt).toBeNull();

    // A repair is meaningful engagement but not "value delivered".
    const repairOnly = firstSessionMilestones([ev("plan_repair_completed", 1)]);
    expect(repairOnly.firstMeaningfulActionAt).not.toBeNull();
    expect(repairOnly.firstValueAt).toBeNull();

    // A completed action is value.
    const done = firstSessionMilestones([ev("now_action_done", 1)]);
    expect(done.firstValueAt).not.toBeNull();
  });

  it("the meaningful/value event sets are durable, view-free", () => {
    expect(MEANINGFUL_ACTION_EVENTS).not.toContain("now_viewed");
    expect(VALUE_EVENTS).not.toContain("now_viewed");
    expect(VALUE_EVENTS).not.toContain("plan_repair_completed");
  });
});

describe("first-session funnel", () => {
  it("is ordered and marks reached vs not", () => {
    const funnel = firstSessionFunnel([ev("onboarding_completed", 0), ev("checkin_completed", 1)]);
    expect(funnel.map((s) => s.milestone)).toEqual([
      "onboardingCompletedAt",
      "firstCheckinAt",
      "planCreatedAt",
      "firstMeaningfulActionAt",
      "firstValueAt",
    ]);
    expect(funnel[0].reached).toBe(true);
    expect(funnel[2].reached).toBe(false);
  });
});

describe("first_value within the session window", () => {
  const now = new Date("2026-08-14T12:00:00Z"); // well after the session

  it("reached when value lands inside the window", () => {
    const events = [ev("onboarding_completed", 0), ev("now_action_done", 10)];
    expect(reachedFirstValueInSession(events, now, 30)).toEqual({ reached: true, pending: false });
  });

  it("value after the window closes is not a first-session win", () => {
    const events = [ev("onboarding_completed", 0), ev("now_action_done", 45)];
    expect(reachedFirstValueInSession(events, now, 30)).toEqual({ reached: false, pending: false });
  });

  it("no value yet but window still open → pending, not a miss", () => {
    const start = new Date("2026-08-14T09:00:00Z");
    const events = [ev("onboarding_completed", 0)];
    const justAfterStart = new Date(start.getTime() + 5 * 60_000);
    expect(reachedFirstValueInSession(events, justAfterStart, 30)).toEqual({
      reached: false,
      pending: true,
    });
  });

  it("no session start at all → not reached, not pending", () => {
    expect(reachedFirstValueInSession([ev("now_viewed", 1)], now, 30)).toEqual({
      reached: false,
      pending: false,
    });
  });
});
