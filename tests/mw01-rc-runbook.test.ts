import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-01 (v19): the immutable RC cut is owner-gated. This prompt must NOT fake a
 * certified candidate — it produces the owner runbook and leaves verdicts
 * unassessed until the immutable workflow records evidence at a single SHA.
 */

const runbook = readFileSync("docs/release/v19/MW-01-rc-runbook.md", "utf8");

describe("the v19 RC runbook is honest and complete", () => {
  it("states the RC cut is owner-gated / blocked, not certified here", () => {
    expect(runbook).toMatch(/owner-gated|BLOCKED on owner action/i);
  });

  it("requires a fresh RC because v19 drifts past the v16 baseline", () => {
    expect(runbook).toContain("e40737b");
    expect(runbook).toMatch(/superseded/i);
  });

  it("names the immutable workflow and the promotion script", () => {
    expect(runbook).toContain("release-candidate.yml");
    expect(runbook).toContain("promote-candidate.mjs");
  });

  it("keeps live-money and production release-check as separate owner evidence", () => {
    expect(runbook).toMatch(/P0-LIVE-TRANSACTION/);
    expect(runbook).toMatch(/release-check/);
  });

  it("leaves all tiers UNASSESSED until the RC is cut", () => {
    expect(runbook).toMatch(/UNASSESSED/);
  });
});

describe("no v19 change faked a certified candidate", () => {
  it("the active manifest still has a null rcSha (no frozen candidate)", () => {
    const manifest = JSON.parse(
      readFileSync("docs/release/manifest.v16.json", "utf8")
    ) as { rcSha: string | null; candidateLifecycle: string };
    expect(manifest.rcSha).toBeNull();
    expect(manifest.candidateLifecycle).toBe("draft");
  });
});
