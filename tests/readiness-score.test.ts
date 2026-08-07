import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReleaseManifest } from "@/lib/release/manifest";
import { scoreReadiness } from "@/lib/release/readiness-score";

/**
 * XAPP-95-02: the non-compensating readiness rubric. A P0 caps the tier it
 * blocks below 8; a not_run owner gate caps public paid below 9; 9.5 needs every
 * gate AND mature value. These fixtures prove no amount of green elsewhere buys
 * back a failed gate.
 */

const SHA = "1111111111111111111111111111111111111111";

/** A fully green, frozen candidate with no open blockers. */
function greenFrozen(): ReleaseManifest {
  return {
    schema: 1,
    release: "test",
    baselineSha: SHA,
    rcSha: SHA,
    candidateLifecycle: "frozen",
    reconciledAtUtc: "2026-08-07T00:00:00Z",
    buildId: null,
    migrations: ["001"],
    suites: [
      {
        id: "unit",
        command: "npx vitest run",
        required: true,
        status: "local_pass",
        sha: SHA,
        counts: { total: 10, passed: 10, failed: 0, skipped: 0 },
        evidence: "docs/release/evidence/test/unit.txt",
      },
    ],
    ownerEvidence: [],
    blockers: [],
    verdicts: {
      automated_code_gate: "CONDITIONAL GO",
      capped_beta: "CONDITIONAL GO",
      public_paid: "NO-GO",
    },
    rollback: "Flag-based; additive migrations.",
    documents: [],
  };
}

describe("9.5 is reachable only when every gate and mature value pass", () => {
  it("awards >= 9.5 to beta and public paid when all gates and value pass", () => {
    const r = scoreReadiness({
      manifest: greenFrozen(),
      migrationsOnDisk: ["001"],
      authE2eAtCandidate: "preview_pass",
      liveTransaction: "live_rehearsed",
      matureValue: "pass",
    });
    expect(r.cappedBeta.score).toBeGreaterThanOrEqual(9.5);
    expect(r.publicPaid.score).toBeGreaterThanOrEqual(9.5);
    expect(r.publicPaid.capped).toBe(false);
  });
});

describe("an open P0 caps the tier it blocks below 8", () => {
  it("caps public paid below 8 for a P0 blocking it, no matter the other gates", () => {
    const m = greenFrozen();
    m.blockers = [
      {
        id: "P0-BILLING",
        level: "P0",
        title: "billing isolation defect",
        owner: "Eng",
        blocks: ["public_paid"],
        acceptance: "fixed + tested",
      },
    ];
    const r = scoreReadiness({
      manifest: m,
      migrationsOnDisk: ["001"],
      authE2eAtCandidate: "preview_pass",
      liveTransaction: "live_rehearsed",
      matureValue: "pass",
    });
    expect(r.publicPaid.score).toBeLessThan(8);
    expect(r.publicPaid.blockers).toContain("P0-BILLING");
    // The beta tier the P0 does not block is not capped by it.
    expect(r.cappedBeta.score).toBeGreaterThanOrEqual(9.5);
    // Product capability is also capped below 8 by an open P0.
    expect(r.product.score).toBeLessThan(8);
  });
});

describe("a not_run owner gate caps public paid below 9", () => {
  it("caps public paid below 9 when the live-money rehearsal is not recorded", () => {
    const r = scoreReadiness({
      manifest: greenFrozen(),
      migrationsOnDisk: ["001"],
      authE2eAtCandidate: "preview_pass",
      liveTransaction: "not_run",
      matureValue: "pass",
    });
    expect(r.publicPaid.score).toBeLessThan(9);
    expect(r.publicPaid.caps.join(" ")).toMatch(/live-money/i);
  });

  it("caps public paid below 9 when authenticated E2E is not observed", () => {
    const r = scoreReadiness({
      manifest: greenFrozen(),
      migrationsOnDisk: ["001"],
      authE2eAtCandidate: "not_run",
      liveTransaction: "live_rehearsed",
      matureValue: "pass",
    });
    expect(r.publicPaid.score).toBeLessThan(9);
  });
});

describe("mature value is required for a 9.5 public-paid, and pending is not a pass", () => {
  it("keeps public paid below 9.5 while the value cohort is immature", () => {
    const r = scoreReadiness({
      manifest: greenFrozen(),
      migrationsOnDisk: ["001"],
      authE2eAtCandidate: "preview_pass",
      liveTransaction: "live_rehearsed",
      matureValue: "immature",
    });
    expect(r.publicPaid.score).toBeLessThan(9.5);
  });
});

describe("a draft with no frozen candidate cannot reach a tier 9.5", () => {
  it("caps beta and public paid below 9 for an unfrozen candidate", () => {
    const m = greenFrozen();
    m.rcSha = null;
    m.candidateLifecycle = "draft";
    const r = scoreReadiness({ manifest: m, migrationsOnDisk: ["001"] });
    expect(r.cappedBeta.score).toBeLessThan(9);
    expect(r.publicPaid.score).toBeLessThan(9);
  });
});

describe("an invalid release record caps every tier low", () => {
  it("caps all tiers at the invalid ceiling", () => {
    const m = greenFrozen();
    // Break it: a passing suite at the wrong SHA is a stale_sha violation.
    m.suites[0].sha = "2222222222222222222222222222222222222222";
    const r = scoreReadiness({ manifest: m, migrationsOnDisk: ["001"] });
    expect(r.manifestValid).toBe(false);
    expect(r.product.score).toBeLessThanOrEqual(5);
    expect(r.publicPaid.score).toBeLessThanOrEqual(5);
  });
});

describe("the real current v16 manifest scores honestly", () => {
  const manifest = JSON.parse(
    readFileSync("docs/release/manifest.v16.json", "utf8")
  ) as ReleaseManifest;

  it("is a draft, so beta and public paid stay below 9.5 with owner gates open", () => {
    const r = scoreReadiness({ manifest });
    expect(r.cappedBeta.score).toBeLessThan(9.5);
    expect(r.publicPaid.score).toBeLessThan(9.5);
    // The two owner gates surface as public-paid blockers/caps.
    expect(r.publicPaid.caps.join(" ")).toMatch(/candidate|owner|E2E|live/i);
  });
});
