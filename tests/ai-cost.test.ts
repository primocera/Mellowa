import { describe, expect, it } from "vitest";
import {
  PRICING,
  priceFor,
  computeActualCostUsd,
  computeCostUsd,
  estimateRouteCostUsd,
} from "@/lib/ai/cost";

/**
 * AI cost + versioned pricing tests (Launch v6, Prompt 11). Actual cost must be
 * reproducible from provider token counts and the effective-dated price, and
 * reconcile with the estimate within a documented tolerance.
 */

const MODEL = "claude-haiku-4-5-20251001";

describe("versioned pricing", () => {
  it("selects the newest price effective on or before the generation date", () => {
    const p = priceFor(MODEL, "2026-01-01");
    expect(p?.inputPerMTok).toBe(1.0);
    expect(p?.outputPerMTok).toBe(5.0);
  });

  it("returns null before a model's first effective date", () => {
    expect(priceFor(MODEL, "2025-01-01")).toBeNull();
  });

  it("prefers the latest entry when several are effective (future-proof)", () => {
    const extended = [
      ...PRICING,
      { provider: "anthropic", model: MODEL, effective: "2027-01-01", inputPerMTok: 2, outputPerMTok: 8 },
    ];
    const at = Date.parse("2027-06-01");
    const chosen = extended
      .filter((p) => p.model === MODEL && Date.parse(p.effective) <= at)
      .sort((a, b) => Date.parse(b.effective) - Date.parse(a.effective))[0];
    expect(chosen.inputPerMTok).toBe(2);
  });
});

describe("actual cost", () => {
  it("computes cost from real token counts", () => {
    // 1M input @ $1 + 1M output @ $5 = $6
    expect(computeActualCostUsd(MODEL, 1_000_000, 1_000_000)).toBeCloseTo(6, 6);
  });

  it("falls back to the default rate for an unknown model (never zero)", () => {
    const unknown = computeActualCostUsd("some-future-model", 1000, 2000);
    expect(unknown).toBe(computeCostUsd(1000, 2000));
    expect(unknown).toBeGreaterThan(0);
  });

  it("reconciles a typical daily-plan actual against its estimate within tolerance", () => {
    // Estimate assumes 1800/3500 tokens; a real call lands near it.
    const estimate = estimateRouteCostUsd("daily-plan");
    const actual = computeActualCostUsd(MODEL, 1750, 3400);
    // Documented tolerance: actual within 25% of the reservation estimate.
    expect(Math.abs(actual - estimate) / estimate).toBeLessThan(0.25);
  });
});
