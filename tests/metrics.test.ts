import { describe, expect, it } from "vitest";
import {
  funnelConversion,
  conversionRate,
  retention,
  unitEconomics,
  reconcile,
  detectAnomalies,
  suppress,
  MIN_COHORT,
  type EventRow,
  type SubRow,
} from "@/lib/analytics/metrics";

/**
 * Fixture-based metric tests (Launch v6, Prompt 10). A seeded cohort proves the
 * KPIs are reproducible and reconcile with server-authoritative counts, and
 * that small cohorts are suppressed.
 */

const DAY = 24 * 3600 * 1000;
const base = Date.parse("2026-06-01T00:00:00Z");
const iso = (offsetDays: number) => new Date(base + offsetDays * DAY).toISOString();

function ev(event: string, user: string, offsetDays = 0): EventRow {
  return { event, user_id: user, anon_id: null, created_at: iso(offsetDays) };
}

// 8 users reach sample_plan_generated; 6 start a trial; 3 convert.
const users = Array.from({ length: 8 }, (_, i) => `u${i}`);
const events: EventRow[] = [
  ...users.map((u) => ev("sample_plan_generated", u, 0)),
  ...users.slice(0, 6).map((u) => ev("trial_started", u, 1)),
  ...users.slice(0, 3).map((u) => ev("trial_converted", u, 4)),
  // day-1 return for 5 of the 8 activated users
  ...users.slice(0, 5).map((u) => ev("checkin_completed", u, 1)),
  ...users.map((u) => ev("plan_generated", u, 0)),
];

describe("funnel & conversion", () => {
  it("counts distinct subjects per step without double-counting", () => {
    // repeat an event to ensure a subject isn't counted twice
    const withDupes = [...events, ev("sample_plan_generated", "u0", 0)];
    const mon = funnelConversion(withDupes, "monetization");
    const trialStep = mon.find((s) => s.event === "trial_started")!;
    expect(trialStep.reached).toBe(6);
  });

  it("computes sample→trial and trial→paid rates", () => {
    expect(conversionRate(events, "sample_plan_generated", "trial_started").rate).toBe(0.75);
    expect(conversionRate(events, "trial_started", "trial_converted").rate).toBe(0.5);
  });

  it("suppresses conversion when the denominator is below MIN_COHORT", () => {
    const tiny = [ev("sample_plan_generated", "a"), ev("trial_started", "a")];
    expect(conversionRate(tiny, "sample_plan_generated", "trial_started").rate).toBeNull();
  });
});

describe("retention", () => {
  it("computes D1 retained activation", () => {
    // 5 of 8 returned on day 1 → 0.625
    expect(retention(events, "sample_plan_generated", ["checkin_completed"], 1)).toBe(0.625);
  });

  it("suppresses retention for tiny activation cohorts", () => {
    const tiny = [ev("sample_plan_generated", "a"), ev("checkin_completed", "a", 1)];
    expect(retention(tiny, "sample_plan_generated", ["checkin_completed"], 1)).toBeNull();
  });
});

describe("unit economics", () => {
  const subs: SubRow[] = [
    ...Array.from({ length: 4 }, (_, i) => sub(`m${i}`, "active", "pro_monthly")),
    ...Array.from({ length: 2 }, (_, i) => sub(`y${i}`, "active", "pro_yearly")),
    sub("t0", "trialing", "pro_monthly"),
  ];

  it("estimates MRR and per-user contribution, excluding fees", () => {
    const e = unitEconomics(subs, [{ estimated_cost_usd: 5, created_at: iso(0) }], 1);
    // 4 * 9.99 + 2 * (59.99/12) = 39.96 + 9.998 = 49.958 → 49.96
    expect(e.activePayers).toBe(6);
    expect(e.mrrEur).toBe(49.96);
    expect(e.note).toMatch(/excludes stripe fees/i);
  });

  it("suppresses economics below MIN_COHORT payers", () => {
    const e = unitEconomics([sub("m0", "active", "pro_monthly")], [], 1);
    expect(e.mrrEur).toBeNull();
    expect(e.contributionPerUserEur).toBeNull();
  });
});

describe("reconciliation & anomalies", () => {
  it("reconciles event counts with system-of-record within tolerance", () => {
    expect(reconcile(100, 100, "plans").reconciled).toBe(true);
    expect(reconcile(100, 103, "plans", 2).reconciled).toBe(false);
    expect(reconcile(100, 101, "plans", 2).reconciled).toBe(true);
  });

  it("flags a major funnel drop against baseline", () => {
    const anomalies = detectAnomalies(
      { signup_completed: 3 },
      { signup_completed: 20 },
      0.4
    );
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].metric).toBe("signup_completed");
  });

  it("ignores drops when the baseline cohort is tiny", () => {
    expect(detectAnomalies({ x: 0 }, { x: 3 })).toEqual([]);
  });
});

it("suppress() gates on MIN_COHORT", () => {
  expect(suppress(42, MIN_COHORT)).toBe(42);
  expect(suppress(42, MIN_COHORT - 1)).toBeNull();
});

function sub(user: string, status: string, plan: string): SubRow {
  return { user_id: user, status, plan_name: plan, created_at: iso(0) };
}
