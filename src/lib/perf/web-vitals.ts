/**
 * Privacy-safe real-user Web Vitals — shared contract (MW-V12-07).
 *
 * Warm lab numbers (the perf Playwright project) tell you the page is capable
 * of being fast; they cannot tell you what a real first-time visitor on a cold
 * serverless function and a mid-range phone actually experiences. This is the
 * field half. It is deliberately minimal and anonymous: a metric, its rating,
 * the app route, a coarse device class and the build id — nothing that could
 * identify a person or carry wellbeing content.
 *
 * What is NOT collected, by construction: user id, anon id, IP-derived data,
 * check-in text, plan content, email, query strings. The value is coarsened to
 * a rating (good / needs-improvement / poor) plus a bucketed millisecond figure,
 * so no high-precision timing can be used to single someone out.
 *
 * Pure module — imported by both the client collector and the ingest route, so
 * the two can never disagree on what is allowed.
 */

export const VITAL_METRICS = ["LCP", "CLS", "INP", "FCP", "TTFB"] as const;
export type VitalMetric = (typeof VITAL_METRICS)[number];

export const VITAL_RATINGS = ["good", "needs-improvement", "poor"] as const;
export type VitalRating = (typeof VITAL_RATINGS)[number];

export const DEVICE_CLASSES = ["phone", "tablet", "desktop"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/**
 * Web Vitals "good"/"poor" thresholds (Google). CLS is unitless; the rest are
 * milliseconds. Values at or below `good` are good; above `poor` are poor.
 */
const THRESHOLDS: Record<VitalMetric, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
  CLS: { good: 0.1, poor: 0.25 },
};

export function rateVital(metric: VitalMetric, value: number): VitalRating {
  const t = THRESHOLDS[metric];
  if (value <= t.good) return "good";
  if (value <= t.poor) return "needs-improvement";
  return "poor";
}

/** Coarse device class from viewport width — never a user-agent fingerprint. */
export function deviceClassForWidth(width: number): DeviceClass {
  if (width < 600) return "phone";
  if (width < 1024) return "tablet";
  return "desktop";
}

/**
 * Reduce any URL to a bounded app-route label: pathname only, no query or hash,
 * with id-shaped segments collapsed so a route can never carry an identifier.
 * Mirrors the analytics taxonomy's `route` rule.
 */
export function sanitizeRoute(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || "/";
  const collapsed = path
    .split("/")
    .map((seg) =>
      /^[0-9a-f]{8,}$/i.test(seg) ||
      /^\d+$/.test(seg) ||
      /^[0-9a-f-]{20,}$/i.test(seg)
        ? ":id"
        : seg,
    )
    .join("/");
  return collapsed.slice(0, 80) || "/";
}

/**
 * Bucket a millisecond value to reduce precision (privacy) while keeping it
 * useful: 50ms buckets under 1s, 250ms buckets above. CLS (a small ratio) is
 * bucketed to hundredths. The rating is the primary field; this is secondary.
 */
export function bucketValue(metric: VitalMetric, value: number): number {
  if (metric === "CLS") return Math.round(value * 100) / 100;
  if (value < 1000) return Math.round(value / 50) * 50;
  return Math.round(value / 250) * 250;
}

export interface VitalSample {
  metric: VitalMetric;
  rating: VitalRating;
  value: number;
  route: string;
  deviceClass: DeviceClass;
  buildId: string;
}

/** Minimum samples before a field percentile may be quoted in a launch doc. */
export const MIN_FIELD_SAMPLES = 100;
/** The percentile a field claim must report (never a mean). */
export const FIELD_PERCENTILE = 75;
