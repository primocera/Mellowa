import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIELD_PERCENTILE,
  MIN_FIELD_SAMPLES,
  bucketValue,
  deviceClassForWidth,
  rateVital,
  sanitizeRoute,
} from "@/lib/perf/web-vitals";

/**
 * MW-V12-07: real-user Web Vitals must be useful AND anonymous.
 *
 * The failure this guards against is the one every RUM setup risks: a field
 * pipeline that quietly carries a route with an id in it, a raw high-precision
 * timing, or a user attribution — turning "how fast is the landing page" into a
 * way to single someone out.
 */

describe("ratings follow the Web Vitals thresholds", () => {
  it("rates LCP good/needs-improvement/poor at the right boundaries", () => {
    expect(rateVital("LCP", 2500)).toBe("good");
    expect(rateVital("LCP", 2501)).toBe("needs-improvement");
    expect(rateVital("LCP", 4001)).toBe("poor");
  });

  it("rates CLS on its unitless scale", () => {
    expect(rateVital("CLS", 0.1)).toBe("good");
    expect(rateVital("CLS", 0.2)).toBe("needs-improvement");
    expect(rateVital("CLS", 0.3)).toBe("poor");
  });

  it("rates INP", () => {
    expect(rateVital("INP", 200)).toBe("good");
    expect(rateVital("INP", 500)).toBe("needs-improvement");
    expect(rateVital("INP", 501)).toBe("poor");
  });
});

describe("device class is coarse, never a fingerprint", () => {
  it("buckets by width only", () => {
    expect(deviceClassForWidth(375)).toBe("phone");
    expect(deviceClassForWidth(800)).toBe("tablet");
    expect(deviceClassForWidth(1440)).toBe("desktop");
  });
});

describe("the route can never carry an identifier", () => {
  it("drops query strings and hashes", () => {
    expect(sanitizeRoute("/pricing?utm=x&id=42#top")).toBe("/pricing");
  });

  it("collapses id-shaped segments", () => {
    expect(sanitizeRoute("/plans/8f3a9c2b1d4e/edit")).toBe("/plans/:id/edit");
    expect(sanitizeRoute("/users/12345")).toBe("/users/:id");
    expect(sanitizeRoute("/x/2f1e9d8c-7b6a-5c4d-3e2f-1a0b9c8d7e6f")).toBe("/x/:id");
  });

  it("keeps a plain app path and bounds length", () => {
    expect(sanitizeRoute("/today")).toBe("/today");
    expect(sanitizeRoute("/")).toBe("/");
    expect(sanitizeRoute("/" + "a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("values are bucketed to reduce precision", () => {
  it("buckets timing metrics", () => {
    expect(bucketValue("LCP", 812)).toBe(800); // 50ms buckets under 1s
    expect(bucketValue("LCP", 4080)).toBe(4000); // 250ms buckets over 1s
  });
  it("buckets CLS to hundredths", () => {
    expect(bucketValue("CLS", 0.1234)).toBe(0.12);
  });
});

describe("field-claim discipline is codified", () => {
  it("requires a real sample count and a percentile, not a mean", () => {
    expect(MIN_FIELD_SAMPLES).toBeGreaterThanOrEqual(100);
    expect(FIELD_PERCENTILE).toBe(75);
  });
});

describe("the ingest endpoint is anonymous and server-authoritative", () => {
  const route = readFileSync("src/app/api/vitals/route.ts", "utf8");

  it("never reads the session or attributes to a user", () => {
    expect(route).not.toMatch(/auth\.getUser|supabase\.auth|user\.id|anon_id/);
  });

  it("recomputes the rating and route server-side, ignoring client claims", () => {
    expect(route).toContain("rateVital(metric, parsed.data.value)");
    expect(route).toContain("sanitizeRoute(parsed.data.route)");
  });

  it("validates against closed enums", () => {
    expect(route).toContain("z.enum(VITAL_METRICS)");
    expect(route).toContain("z.enum(DEVICE_CLASSES)");
  });

  it("stores no user column — the table is anonymous by construction", () => {
    const migration = readFileSync(
      "supabase/migrations/041_mellowa_v12_web_vitals.sql",
      "utf8",
    );
    // Strip SQL comments first: the comment explains it stores NO user_id, and
    // that promise must not be mistaken for a column named user_id.
    const sqlCode = migration
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sqlCode).not.toMatch(/user_id|anon_id/);
    expect(migration).toMatch(/enable row level security/i);
  });
});

describe("the collector sends only anonymous fields", () => {
  const collectorRaw = readFileSync("src/components/dailyflow/web-vitals.tsx", "utf8");
  // Strip comments: the JSDoc lists what is NOT collected (user id, session…),
  // which is prose, not code, and must not trip the code-usage assertion.
  const collector = collectorRaw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

  it("observes LCP, CLS and INP", () => {
    expect(collector).toContain("largest-contentful-paint");
    expect(collector).toContain("layout-shift");
    // INP via the Event Timing API's interactionId.
    expect(collector).toContain("interactionId");
  });

  it("beacons to /api/vitals and never blocks the page", () => {
    expect(collector).toContain("/api/vitals");
    expect(collector).toContain("sendBeacon");
  });

  it("carries no user id, session or query string in its code", () => {
    expect(collector).not.toMatch(/user_id|userId|getUser|anon_id|\.auth\b/);
    // Route is sanitised before it leaves the browser.
    expect(collector).toContain("sanitizeRoute(");
  });
});
