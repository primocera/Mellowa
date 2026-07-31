import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DATA_STALE_AFTER_HOURS,
  MIN_COHORT,
  dataFreshness,
} from "@/lib/analytics/metrics";
import { loopDecisions, expansionVerdict } from "@/lib/analytics/loop-decisions";

/**
 * MW-V12-08: the beta scorecard must not let a stale or empty pipeline read as a
 * result, and expansion must default to BLOCKED until every required metric has
 * enough data. Both are decision-safety properties, not display niceties.
 */

describe("data freshness reveals a quiet pipeline", () => {
  const now = new Date("2026-07-31T12:00:00Z");

  it("treats an empty window as stale, never as fresh", () => {
    const f = dataFreshness([], now);
    expect(f.lastEventAt).toBeNull();
    expect(f.ageHours).toBeNull();
    expect(f.stale).toBe(true);
  });

  it("reports a recent window as fresh", () => {
    const f = dataFreshness([{ created_at: "2026-07-31T10:00:00Z" }], now);
    expect(f.stale).toBe(false);
    expect(f.ageHours).toBe(2);
  });

  it("flags a window whose newest event is older than the staleness bound", () => {
    const old = new Date(now.getTime() - (DATA_STALE_AFTER_HOURS + 1) * 3_600_000);
    const f = dataFreshness([{ created_at: old.toISOString() }], now);
    expect(f.stale).toBe(true);
  });

  it("uses the NEWEST event, not the first it sees", () => {
    const f = dataFreshness(
      [
        { created_at: "2026-07-01T00:00:00Z" },
        { created_at: "2026-07-31T09:00:00Z" },
        { created_at: "2026-07-15T00:00:00Z" },
      ],
      now,
    );
    expect(f.ageHours).toBe(3);
  });
});

describe("expansion is BLOCKED by default and until the data can be read", () => {
  it("cannot expand on a cohort below the minimum — nothing is readable", () => {
    // A single value-loop step with a denominator under MIN_COHORT.
    const loop = loopDecisions([
      { event: "sample_plan_generated", reached: MIN_COHORT - 1, stepRate: null },
      { event: "checkin_completed", reached: 1, stepRate: null },
    ]);
    const verdict = expansionVerdict(loop, 28);
    expect(verdict.canExpand).toBe(false);
  });

  it("MIN_COHORT is the small-cohort floor the scorecard doc declares", () => {
    expect(MIN_COHORT).toBe(5);
    const doc = readFileSync("docs/beta-scorecard.md", "utf8");
    expect(doc).toMatch(/under 5|<\s*5/i);
    expect(doc).toMatch(/BLOCKED/);
    expect(doc).toMatch(/blocked is the default/i);
  });
});

describe("the report surfaces freshness to the owner", () => {
  it("MetricsReport carries dataFreshness and the admin renders it", () => {
    const report = readFileSync("src/lib/analytics/report.ts", "utf8");
    expect(report).toContain("dataFreshness: dataFreshness(eventRows");
    const admin = readFileSync("src/app/admin/page.tsx", "utf8");
    expect(admin).toMatch(/Data freshness/i);
    expect(admin).toMatch(/r\.dataFreshness\.stale/);
  });
});
