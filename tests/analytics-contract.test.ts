import { describe, expect, it } from "vitest";
import {
  EVENT_NAMES,
  SERVER_AUTHORITATIVE_EVENTS,
  CLIENT_EVENTS,
  ALLOWED_PROPERTY_KEYS,
  FUNNELS,
  parseEvent,
  type AppEvent,
} from "@/lib/analytics/taxonomy";

/**
 * Analytics contract tests (Launch & Scale v6, Prompt 9). Guard the two
 * acceptance criteria: every funnel is reconstructable without double-counting,
 * and sensitive content cannot be inserted through the typed event API.
 */

describe("analytics taxonomy", () => {
  it("has unique event names", () => {
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });

  it("partitions events into server-authoritative and client sets", () => {
    // Every event is exactly one of the two — no overlap, full coverage.
    for (const e of EVENT_NAMES) {
      const server = SERVER_AUTHORITATIVE_EVENTS.has(e);
      const client = CLIENT_EVENTS.has(e);
      expect(server !== client, `${e} must be exactly one of server/client`).toBe(true);
    }
    expect(SERVER_AUTHORITATIVE_EVENTS.size + CLIENT_EVENTS.size).toBe(
      EVENT_NAMES.length
    );
  });

  it("keeps revenue/identity truth server-authoritative", () => {
    for (const e of [
      "signup_completed",
      "checkout_completed",
      "trial_started",
      "trial_converted",
      "payment_failed",
      "account_deleted",
    ] as AppEvent[]) {
      expect(SERVER_AUTHORITATIVE_EVENTS.has(e), e).toBe(true);
    }
  });
});

describe("event validation", () => {
  it("accepts a known event with enumerated properties", () => {
    const parsed = parseEvent({
      event: "checkout_completed",
      properties: { surface: "billing", plan_interval: "yearly" },
    });
    expect(parsed.event).toBe("checkout_completed");
    expect(parsed.properties.plan_interval).toBe("yearly");
  });

  it("defaults properties to an empty object", () => {
    expect(parseEvent({ event: "signup_started" }).properties).toEqual({});
  });

  it("rejects an unknown event name", () => {
    expect(() => parseEvent({ event: "mood_logged" })).toThrow();
  });

  it("rejects unknown / sensitive property keys", () => {
    for (const key of ["mood", "allergies", "journal", "plan", "note", "email", "name"]) {
      expect(
        () => parseEvent({ event: "plan_feedback", properties: { [key]: "x" } }),
        key
      ).toThrow();
    }
  });

  it("rejects free-text values on allowed keys", () => {
    // A prose value can't ride in on campaign/model_version etc.
    expect(() =>
      parseEvent({ event: "landing_cta_clicked", properties: { campaign: "I feel anxious today" } })
    ).toThrow();
    expect(() =>
      parseEvent({ event: "paywall_viewed", properties: { surface: "not-a-surface" } })
    ).toThrow();
    expect(() =>
      parseEvent({ event: "checkout_started", properties: { plan_interval: "weekly" } })
    ).toThrow();
  });

  it("only allows the documented property keys", () => {
    expect(ALLOWED_PROPERTY_KEYS.sort()).toEqual(
      [
        "campaign",
        "cancel_reason",
        "churn_type",
        "experiment",
        "model_version",
        "outcome",
        "plan_interval",
        "prompt_version",
        "route",
        "source",
        "surface",
      ].sort()
    );
  });
});

describe("metric dictionary", () => {
  it("references only defined events so each funnel is reconstructable", () => {
    const known = new Set<AppEvent>(EVENT_NAMES);
    for (const [name, steps] of Object.entries(FUNNELS)) {
      // No duplicate steps within a funnel (prevents double-counting a stage).
      expect(new Set(steps).size, `${name} has duplicate steps`).toBe(steps.length);
      for (const step of steps) {
        expect(known.has(step), `${name}:${step} is not a defined event`).toBe(true);
      }
    }
  });
});
