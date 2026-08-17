import { describe, expect, it } from "vitest";
import { scaleDecision, type ScaleDecisionInput } from "@/lib/analytics/scale-decision";
import type { CohortScorecard, CohortRow, MetricState } from "@/lib/analytics/cohort";
import type { DiscoveryVerdict } from "@/lib/pricing/discovery-gate";
import type { ObservabilityReport } from "@/lib/observability/report";

/**
 * MW-06 (v20): RUNTIME COMPOSITION tests for the single canonical scale
 * decision. These exercise the real function (not a doc string): the same
 * fixture that would let the legacy expansionVerdict say "expand" is BLOCKED
 * unless every gate is mature-and-passing, pricing discovery is open, operations
 * are ready, there are no disputes, and the owner gates are attached.
 */

function row(
  id: string,
  opts: { rate?: number | null; state?: MetricState; numerator?: number | null; suppressed?: boolean }
): CohortRow {
  return {
    id,
    definition: id,
    numerator: opts.numerator ?? 10,
    denominator: 50,
    pending: 0,
    rate: opts.rate ?? null,
    suppressed: opts.suppressed ?? false,
    state: opts.state ?? "measured",
    maturity: "mature",
    action: "",
  };
}

/** A fully clean, mature cohort: every value gate passes. */
function cleanCohort(overrides: CohortRow[] = []): CohortScorecard {
  const base: CohortRow[] = [
    row("d2_return", { rate: 0.5 }),
    row("d3_return", { rate: 0.4 }),
    row("repeat_repair_distinct_day", { numerator: 5 }),
    row("week_closeout_completed", { rate: 0.4 }),
    row("carry_forward_accepted", { rate: 0.7 }),
    row("trial_converted", { rate: 0.5 }),
    row("first_renewal", { rate: 0.8 }),
    row("refund", { rate: 0.01 }),
    row("dispute", { numerator: 0, rate: 0 }),
  ];
  const byId = new Map(base.map((r) => [r.id, r]));
  for (const o of overrides) byId.set(o.id, o);
  return {
    generatedAt: "",
    definitionVersion: "v",
    activationSource: "canonical_facts",
    sourceWatermark: null,
    matureThroughUtc: "",
    activatedUsers: 50,
    rows: [...byId.values()],
  };
}

const openPricing: DiscoveryVerdict = {
  canRecommendPriceChange: true,
  reasons: [],
  requiredButMissing: [],
  risksPresent: [],
};
const readyObs: ObservabilityReport = {
  slos: [],
  budgets: [],
  capacity: { fits: true } as never,
  scaleReady: true,
  blockingReasons: [],
};

function input(over: Partial<ScaleDecisionInput> = {}): ScaleDecisionInput {
  return {
    cohort: cleanCohort(),
    pricingDiscovery: openPricing,
    observability: readyObs,
    dataStale: false,
    disputes: 0,
    betaCapReached: false,
    releaseGatesPassed: true,
    ...over,
  };
}

describe("scaleDecision truth table (MW-06)", () => {
  it("the FULL clean mature fixture yields a small bounded expansion", () => {
    const d = scaleDecision(input());
    expect(d.verdict).toBe("SMALL_BOUNDED_EXPANSION");
    expect(d.canExpand).toBe(true);
    expect(d.blocker).toBeNull();
  });

  it("any dispute → STOP (even with everything else perfect)", () => {
    const d = scaleDecision(input({ disputes: 1 }));
    expect(d.verdict).toBe("STOP");
    expect(d.canExpand).toBe(false);
  });

  it("dispute detected from the cohort row when disputes count is null", () => {
    const cohort = cleanCohort([row("dispute", { numerator: 2, rate: 0.04 })]);
    const d = scaleDecision(input({ cohort, disputes: null }));
    expect(d.verdict).toBe("STOP");
  });

  it("daily return passes but capacity unavailable → BLOCK (not expand)", () => {
    const obs: ObservabilityReport = {
      ...readyObs,
      scaleReady: false,
      blockingReasons: ["provider capacity unavailable"],
    };
    const d = scaleDecision(input({ observability: obs }));
    expect(d.verdict).toBe("BLOCK");
    expect(d.canExpand).toBe(false);
  });

  it("a measured operational breach → PAUSE_INTAKE", () => {
    const obs: ObservabilityReport = {
      ...readyObs,
      scaleReady: false,
      blockingReasons: ["ai_cost_per_activated over budget"],
    };
    expect(scaleDecision(input({ observability: obs })).verdict).toBe("PAUSE_INTAKE");
  });

  it("all value metrics pass but support ingestion unverified → HOLD, not expand", () => {
    const pricing: DiscoveryVerdict = {
      canRecommendPriceChange: false,
      reasons: [],
      requiredButMissing: ["support_burden"],
      risksPresent: [],
    };
    const d = scaleDecision(input({ pricingDiscovery: pricing }));
    expect(d.canExpand).toBe(false);
    expect(d.verdict).toBe("HOLD");
    expect(d.blocker).toBe("pricing_discovery_closed");
  });

  it("an unresolved safety/billing/deletion issue → STOP", () => {
    const pricing: DiscoveryVerdict = {
      canRecommendPriceChange: false,
      reasons: [],
      requiredButMissing: [],
      risksPresent: ["unresolved_safety_billing_deletion"],
    };
    expect(scaleDecision(input({ pricingDiscovery: pricing })).verdict).toBe("STOP");
  });

  it("mature but weak carry-forward → ITERATE, never expand", () => {
    const cohort = cleanCohort([row("carry_forward_accepted", { rate: 0.2 })]);
    const d = scaleDecision(input({ cohort }));
    expect(d.verdict).toBe("ITERATE");
    expect(d.canExpand).toBe(false);
  });

  it("immature renewal denominator → HOLD (unavailable means wait, not zero)", () => {
    const cohort = cleanCohort([row("first_renewal", { state: "pending", rate: null })]);
    const d = scaleDecision(input({ cohort }));
    expect(d.verdict).toBe("HOLD");
    expect(d.blocker).toBe("immature_evidence");
  });

  it("suppressed (small-n) refund metric is immature → HOLD, not a pass", () => {
    const cohort = cleanCohort([row("refund", { rate: null, state: "measured" })]);
    expect(scaleDecision(input({ cohort })).canExpand).toBe(false);
  });

  it("owner/release gates not attached → HOLD even when data is perfect", () => {
    const d = scaleDecision(input({ releaseGatesPassed: false }));
    expect(d.verdict).toBe("HOLD");
    expect(d.blocker).toBe("owner_gates_not_passed");
  });

  it("stale data → HOLD", () => {
    expect(scaleDecision(input({ dataStale: true })).verdict).toBe("HOLD");
  });

  it("cap reached → HOLD (growth is a manual owner increment, never automatic)", () => {
    expect(scaleDecision(input({ betaCapReached: true })).verdict).toBe("HOLD");
  });

  it("pricingDiscovery=false OR scaleReady=false each force canExpand=false", () => {
    expect(
      scaleDecision(input({ pricingDiscovery: { ...openPricing, canRecommendPriceChange: false } }))
        .canExpand
    ).toBe(false);
    expect(
      scaleDecision(input({ observability: { ...readyObs, scaleReady: false } })).canExpand
    ).toBe(false);
  });
});
