import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-95-06: the weekly paid-value memo must bind to the CANONICAL metrics report
 * (never re-derive numbers), the synthetic example must be unmistakably marked as
 * not real, and neither document may overclaim a paid-launch verdict. This guards
 * against the exact failure the prompt warns about: a design memo that quietly
 * asserts value or readiness the evidence does not support.
 */

const memo = readFileSync("docs/release/v16/WEEKLY-PAID-VALUE-MEMO.md", "utf8");
const example = readFileSync("docs/release/v16/WEEKLY-PAID-VALUE-EXAMPLE.md", "utf8");
const report = readFileSync("src/lib/analytics/report.ts", "utf8");

describe("weekly paid-value memo binds to canonical metrics", () => {
  it("cites report fields that actually exist in buildMetricsReport", () => {
    // Each token the memo cites as a source must be a real field the report
    // produces, so the memo can never point at a metric that isn't computed.
    for (const field of [
      "sampleToTrial",
      "trialToPaid",
      "costPerOutcome",
      "perRetainedPayerUsd",
      "expansion",
      "dataFreshness",
      "mrrByCurrency",
      "experimentConflicts",
    ]) {
      expect(memo, `memo cites ${field}`).toContain(field);
      expect(report, `report should expose ${field}`).toContain(field);
    }
  });

  it("names all three paid jobs by their concrete daily language", () => {
    for (const job of ["Adapt today", "Reuse what works", "Carry into next week"]) {
      expect(memo).toContain(job);
    }
    // The memo must explicitly FORBID transformation/health language...
    expect(memo).toMatch(/never adherence, recovery, improvement/i);
    // ...and the synthetic example must not slip any of it back in as a claim.
    for (const bad of [/better health/i, /optimized life/i, /guaranteed consistency/i, /recovery/i]) {
      expect(example).not.toMatch(bad);
    }
  });

  it("keeps the deferred cohort metrics honest, not zeroed", () => {
    expect(memo).toMatch(/owner-observed|not yet automated/i);
    expect(memo).toContain("D2/D3");
  });

  it("lists the hard scale-stops including dispute, refund > 5% and stale data", () => {
    expect(memo).toMatch(/dispute/i);
    expect(memo).toMatch(/> ?5%/);
    expect(memo).toMatch(/MIN_COHORT/);
  });

  it("never claims a paid-launch GO or 9.5 from the memo alone", () => {
    expect(memo).toContain("below 9.5");
    expect(memo).toMatch(/not a claim/i);
  });
});

describe("the synthetic example cannot be mistaken for real data", () => {
  it("is prominently labelled NOT REAL DATA", () => {
    expect(example).toContain("NOT REAL DATA");
    // In the title and the first callout, not buried at the end.
    expect(example.slice(0, 400)).toMatch(/NOT REAL DATA/);
  });

  it("still resolves the expansion question to NO and readiness below 9.5", () => {
    expect(example).toMatch(/canExpand.*false|expansion stays \*\*NO\*\*/i);
    expect(example).toMatch(/below 9\.5/);
  });
});
