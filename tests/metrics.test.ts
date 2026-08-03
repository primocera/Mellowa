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
import { CATALOG } from "@/lib/stripe/plans";

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
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const usdMonthlyMinor = CATALOG.usd.monthly.minorUnits;
  const usdYearlyMinor = CATALOG.usd.yearly.minorUnits;
  const eurMonthlyMinor = CATALOG.eur.monthly.minorUnits;

  const usdSubs: SubRow[] = [
    ...Array.from({ length: 4 }, (_, i) => sub(`m${i}`, "active", "pro_monthly", "usd")),
    ...Array.from({ length: 2 }, (_, i) => sub(`y${i}`, "active", "pro_yearly", "usd")),
    sub("t0", "trialing", "pro_monthly", "usd"), // trialing is not an active payer
  ];

  const mixed: SubRow[] = [
    ...Array.from({ length: 5 }, (_, i) => sub(`u${i}`, "active", "pro_monthly", "usd")),
    ...Array.from({ length: 5 }, (_, i) => sub(`e${i}`, "active", "pro_monthly", "eur")),
  ];

  it("reports native MRR per currency, derived from the catalog (no 9.99/59.99)", () => {
    const e = unitEconomics(usdSubs, [{ estimated_cost_usd: 5, created_at: iso(0) }]);
    expect(e.activePayers).toBe(6);
    const usd = e.mrrByCurrency.find((c) => c.currency === "usd")!;
    const expectedMinor = 4 * usdMonthlyMinor + 2 * (usdYearlyMinor / 12);
    expect(usd.activePayers).toBe(6);
    expect(usd.mrrMinor).toBeCloseTo(expectedMinor, 5);
    expect(usd.mrr).toBe(round2(expectedMinor / 100));
    expect(e.aiCostUsd).toBe(5);
    expect(e.note).toMatch(/excludes stripe fees/i);
  });

  it("keeps USD and EUR revenue separate — never summed into one figure", () => {
    const e = unitEconomics(mixed, []);
    expect(e.mrrByCurrency.map((c) => c.currency)).toEqual(["eur", "usd"]);
    const usd = e.mrrByCurrency.find((c) => c.currency === "usd")!;
    const eur = e.mrrByCurrency.find((c) => c.currency === "eur")!;
    expect(usd.mrrMinor).toBe(5 * usdMonthlyMinor);
    expect(eur.mrrMinor).toBe(5 * eurMonthlyMinor);
    // With no FX rate there is no combined total — unknown, not a bogus sum.
    expect(e.normalizedUsd).toBeNull();
  });

  it("treats an unknown/absent currency as unknown — never zero or silently USD", () => {
    const subs: SubRow[] = [
      ...Array.from({ length: 5 }, (_, i) => sub(`u${i}`, "active", "pro_monthly", "usd")),
      sub("x0", "active", "pro_monthly", null),
      sub("x1", "active", "pro_monthly", "gbp"), // unsupported currency
    ];
    const e = unitEconomics(subs, []);
    expect(e.activePayers).toBe(7);
    expect(e.unknownCurrencyPayers).toBe(2);
    const usd = e.mrrByCurrency.find((c) => c.currency === "usd")!;
    expect(usd.activePayers).toBe(5); // the 2 unknowns are excluded, not counted
    expect(usd.mrrMinor).toBe(5 * usdMonthlyMinor);
  });

  it("normalizes to USD only with an explicit, sourced FX rate", () => {
    const noFx = unitEconomics(mixed, [{ estimated_cost_usd: 10, created_at: iso(0) }]);
    expect(noFx.normalizedUsd).toBeNull(); // unknown, not zero

    const fx = { usdPer: { eur: 1.1 }, source: "ECB", asOf: "2026-08-01" };
    const e = unitEconomics(mixed, [{ estimated_cost_usd: 10, created_at: iso(0) }], { fx });
    expect(e.normalizedUsd).not.toBeNull();
    expect(e.normalizedUsd!.label).toBe("ESTIMATE");
    expect(e.normalizedUsd!.fx.source).toBe("ECB");
    const usdMinor = 5 * usdMonthlyMinor + 5 * eurMonthlyMinor * 1.1;
    expect(e.normalizedUsd!.mrrUsd).toBe(round2(usdMinor / 100));
    expect(e.normalizedUsd!.contributionPerPayerUsd).toBe(round2((usdMinor / 100 - 10) / 10));
  });

  it("leaves the normalized total unknown when a present currency has no FX rate", () => {
    const fx = { usdPer: {}, source: "ECB", asOf: "2026-08-01" }; // no eur rate
    const e = unitEconomics(mixed, [], { fx });
    expect(e.normalizedUsd!.mrrUsd).toBeNull();
    expect(e.normalizedUsd!.contributionPerPayerUsd).toBeNull();
  });

  it("suppresses a per-currency figure below MIN_COHORT payers", () => {
    const e = unitEconomics([sub("m0", "active", "pro_monthly", "usd")], []);
    const usd = e.mrrByCurrency.find((c) => c.currency === "usd")!;
    expect(usd.activePayers).toBe(1);
    expect(usd.mrr).toBeNull(); // suppressed — not enough people to show a figure
    expect(e.aiCostUsd).toBeNull();
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

function sub(
  user: string,
  status: string,
  plan: string,
  currency: string | null = "usd"
): SubRow {
  return { user_id: user, status, plan_name: plan, created_at: iso(0), currency };
}
