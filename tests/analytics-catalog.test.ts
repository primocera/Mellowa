import { describe, expect, it } from "vitest";
import {
  EVENT_CATALOG,
  NORTH_STAR,
  BUSINESS_FACT_CLASSES,
  CATALOG_VERSION,
} from "@/lib/analytics/catalog";
import {
  EVENT_NAMES,
  SERVER_AUTHORITATIVE_EVENTS,
  ANALYTICS_VERSION,
  FUNNELS,
  type AppEvent,
} from "@/lib/analytics/taxonomy";

/**
 * MW-V18-X01: the published event catalog is complete, consistent with the
 * taxonomy's server/client partition, and never lets a business fact (money,
 * identity, value milestone) be proven by app_events. The north-star is a
 * server-confirmed loop, not a page view.
 */

describe("catalog completeness", () => {
  it("has exactly one entry per event name, and no extras", () => {
    const catalogKeys = Object.keys(EVENT_CATALOG).sort();
    expect(catalogKeys).toEqual([...EVENT_NAMES].sort());
  });

  it("is versioned in lockstep with the taxonomy", () => {
    expect(CATALOG_VERSION).toBe(ANALYTICS_VERSION);
  });

  it("every entry carries owner, trigger, privacy class, source of truth and dedupe key", () => {
    for (const [event, spec] of Object.entries(EVENT_CATALOG)) {
      expect(spec.owner, `${event}.owner`).toBeTruthy();
      expect(spec.trigger, `${event}.trigger`).toBeTruthy();
      expect(spec.privacyClass, `${event}.privacyClass`).toBeTruthy();
      expect(spec.sourceOfTruth, `${event}.sourceOfTruth`).toBeTruthy();
      expect(spec.dedupeKey, `${event}.dedupeKey`).toBeTruthy();
    }
  });
});

describe("authority is consistent with the taxonomy partition", () => {
  it("server-authoritative events are cataloged as server, all others as client", () => {
    for (const e of EVENT_NAMES as readonly AppEvent[]) {
      const expected = SERVER_AUTHORITATIVE_EVENTS.has(e) ? "server" : "client";
      expect(EVENT_CATALOG[e].authority, e).toBe(expected);
    }
  });
});

describe("business facts never come from app_events", () => {
  it("identity/billing/value events are server authority with a durable source of truth", () => {
    for (const [event, spec] of Object.entries(EVENT_CATALOG)) {
      if (!BUSINESS_FACT_CLASSES.includes(spec.privacyClass)) continue;
      expect(spec.authority, `${event} is a business fact but not server-authoritative`).toBe(
        "server"
      );
      expect(
        /app_events/i.test(spec.sourceOfTruth),
        `${event} must not be proven by app_events`
      ).toBe(false);
    }
  });

  it("client engagement events are only ever interaction claims", () => {
    for (const [event, spec] of Object.entries(EVENT_CATALOG)) {
      if (spec.authority !== "client") continue;
      expect(spec.privacyClass, `${event} client event must be engagement`).toBe("engagement");
    }
  });
});

describe("north-star is a server-confirmed loop", () => {
  it("references a real funnel and only server-authoritative proving events", () => {
    expect(Object.keys(FUNNELS)).toContain(NORTH_STAR.funnel);
    for (const e of NORTH_STAR.provingEvents) {
      expect(SERVER_AUTHORITATIVE_EVENTS.has(e), `${e} must be server-authoritative`).toBe(true);
    }
    // Not reducible to a page view or a raw generation count.
    expect(NORTH_STAR.statement.toLowerCase()).not.toMatch(/page view|pageview/);
  });
});
