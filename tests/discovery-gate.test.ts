import { describe, expect, it } from "vitest";
import { discoveryGate, REQUIRED_ROWS } from "@/lib/pricing/discovery-gate";
import type { CohortScorecard, CohortRow } from "@/lib/analytics/cohort";
import type { SupportBurden } from "@/lib/support/metrics";

/**
 * MW-V18-15: a packaging change is only recommendable when every required
 * cohort is mature and no risk signal is present. Immature/suppressed/
 * unavailable evidence keeps the gate CLOSED with a research plan — never a
 * guessed price change. Read-only; no Stripe involved.
 */

const matureRow = (id: string): CohortRow => ({
  id,
  definition: id,
  numerator: 6,
  denominator: 10,
  pending: 0,
  rate: 0.6,
  suppressed: false,
  state: "measured",
  maturity: "mature",
  action: "",
});

const zeroRiskRow = (id: string): CohortRow => ({
  ...matureRow(id),
  numerator: 0,
  rate: 0,
});

function scorecard(over: Partial<Record<string, CohortRow>> = {}): CohortScorecard {
  const rows: CohortRow[] = [
    ...REQUIRED_ROWS.map((id) => over[id] ?? matureRow(id)),
    over.refund ?? zeroRiskRow("refund"),
    over.dispute ?? zeroRiskRow("dispute"),
  ];
  return {
    generatedAt: "2026-08-14T00:00:00Z",
    definitionVersion: "m05.1",
    activationSource: "canonical_facts",
    sourceWatermark: "2026-08-14T00:00:00Z",
    matureThroughUtc: "2026-08-12",
    activatedUsers: 100,
    rows,
  };
}

const goodSupport: SupportBurden = {
  state: "measured",
  contacts: 5,
  contactsPer100Activated: 5,
  contactsPer100Paid: 10,
  activatedUsers: 100,
  paidUsers: 50,
  medianFirstResponseMin: 60,
  medianResolutionMin: 120,
  reopenRate: 0.1,
  unresolvedCritical: 0,
  byCategory: {},
};

describe("gate opens only on mature evidence with no risk", () => {
  it("recommends when all required cohorts are mature and clean", () => {
    const v = discoveryGate({ cohort: scorecard(), support: goodSupport });
    expect(v.canRecommendPriceChange).toBe(true);
    expect(v.requiredButMissing).toEqual([]);
    expect(v.risksPresent).toEqual([]);
  });
});

describe("gate closes on immature / suppressed / unavailable evidence", () => {
  it("a PENDING required metric closes the gate and names the research plan", () => {
    const pending = { ...matureRow("first_renewal"), state: "pending" as const, denominator: 0, pending: 4 };
    const v = discoveryGate({ cohort: scorecard({ first_renewal: pending }), support: goodSupport });
    expect(v.canRecommendPriceChange).toBe(false);
    expect(v.requiredButMissing).toContain("first_renewal");
  });

  it("a SUPPRESSED metric is not proof", () => {
    const suppressed = { ...matureRow("d2_return"), suppressed: true, numerator: null, rate: null };
    const v = discoveryGate({ cohort: scorecard({ d2_return: suppressed }), support: goodSupport });
    expect(v.canRecommendPriceChange).toBe(false);
    expect(v.requiredButMissing).toContain("d2_return");
  });

  it("unavailable support burden closes the gate", () => {
    const v = discoveryGate({
      cohort: scorecard(),
      support: { ...goodSupport, state: "unavailable", contactsPer100Activated: null },
    });
    expect(v.canRecommendPriceChange).toBe(false);
    expect(v.requiredButMissing).toContain("support_burden");
  });
});

describe("gate closes on risk signals", () => {
  it("a present refund count blocks a packaging change", () => {
    const refund = { ...zeroRiskRow("refund"), numerator: 2 };
    const v = discoveryGate({ cohort: scorecard({ refund }), support: goodSupport });
    expect(v.canRecommendPriceChange).toBe(false);
    expect(v.risksPresent).toContain("refund");
  });

  it("unresolved safety/billing/deletion contacts block outright", () => {
    const v = discoveryGate({
      cohort: scorecard(),
      support: { ...goodSupport, unresolvedCritical: 1 },
    });
    expect(v.canRecommendPriceChange).toBe(false);
    expect(v.risksPresent).toContain("unresolved_safety_billing_deletion");
  });

  it("support load over the ceiling blocks", () => {
    const v = discoveryGate({
      cohort: scorecard(),
      support: { ...goodSupport, contactsPer100Activated: 35 },
      supportPer100Ceiling: 20,
    });
    expect(v.canRecommendPriceChange).toBe(false);
    expect(v.risksPresent.some((r) => r.startsWith("support_load_"))).toBe(true);
  });
});
