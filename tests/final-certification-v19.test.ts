import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * XAPP-03 + FINAL-01 (v19): the final certification must issue SEPARATE verdicts,
 * never call an owner-gated tier GO while its blockers are open, and the bounded
 * operating system must block "expand" on immature/unavailable evidence.
 */

const final = readFileSync("docs/release/v19/FINAL-01-certification.md", "utf8");
const ops = readFileSync("docs/release/v19/XAPP-03-beta-operations.md", "utf8");

describe("FINAL-01 issues honest, separate verdicts", () => {
  it("gives a distinct verdict for product / capped beta / public paid", () => {
    expect(final).toMatch(/Product capability\s*—\s*STRONG/i);
    expect(final).toMatch(/Capped beta\s*—\s*CONDITIONAL GO/i);
    expect(final).toMatch(/Public paid[^—]*—\s*CONDITIONAL GO/i);
  });

  it("keeps bounded paid conditional on the live-money gate, not unconditional GO", () => {
    // bounded paid is CONDITIONAL GO, never a bare/unconditional GO
    expect(final).not.toMatch(/Public paid[^—]*—\s*GO\b/i);
    expect(final).toMatch(/P0-LIVE-TRANSACTION/);
  });

  it("demotes the 4-week window to an optional scaling gate, not a launch blocker", () => {
    expect(final).toMatch(/not\W+a\s+launch\s+blocker/i);
    expect(final).toMatch(/scal(e|ing)/i);
  });

  it("names the immutable-RC blocker and the re-opened auth matrix", () => {
    expect(final).toContain("release-candidate.yml");
    expect(final).toMatch(/re-opened|superseded/i);
  });

  it("has a single next action for the owner", () => {
    expect(final).toMatch(/Single next action/i);
  });

  it("records the automated gate honestly (non-zero test count, 0 vulnerabilities)", () => {
    expect(final).toMatch(/\d{4} tests \/ 0 fail/);
    expect(final).toMatch(/0 vulnerabilities/);
  });
});

describe("XAPP-03 blocks expansion on immature/unavailable evidence", () => {
  it("lists the allowed decisions including stop and expand", () => {
    for (const d of ["stop", "pause intake", "interview", "iterate", "continue bounded", "expand"]) {
      expect(ops.toLowerCase()).toContain(d);
    }
  });
  it("blocks expand while pricing discovery or scale readiness is not ready", () => {
    expect(ops).toContain("pricingDiscovery");
    expect(ops).toContain("scaleReady");
    expect(ops).toMatch(/BLOCKED/);
  });
  it("keeps the predeclared thresholds fixed and treats unavailable as wait", () => {
    expect(ops).toMatch(/D2 ≥ 40%/);
    expect(ops).toMatch(/any dispute is a stop/i);
    expect(ops).toMatch(/never \*?zero\*?|means \*wait\*/i);
  });
  it("keeps the 50-account cap and 4-week window", () => {
    expect(ops).toContain("50 accounts");
    expect(ops).toMatch(/4 weeks|≥ 4 weeks/);
  });
});
