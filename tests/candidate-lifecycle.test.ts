import { describe, expect, it } from "vitest";
import {
  buildCandidate,
  deriveVerdicts,
  validateCandidateArtifact,
  NO_OWNER_EVIDENCE,
} from "../scripts/candidate-lib.mjs";

/**
 * MW-V17-02: the RC workflow uploaded the unchanged DRAFT manifest as evidence
 * and the verdicts were hand-typed. This proves the replacement: a SHA-pinned
 * candidate whose verdicts are DERIVED from the gates and whose record is
 * immutable — a wrong SHA, a tampered verdict, a bare local_pass or a missing
 * artifact all fail validation.
 */

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

/** A minimal frozen manifest with all code gates green and owner gates blocked. */
function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    release: "v17",
    baselineSha: SHA_B,
    rcSha: SHA_A,
    candidateLifecycle: "frozen",
    migrations: ["001", "002", "003"],
    suites: [
      { id: "lint", command: "npm run lint", required: true, status: "ci_pass", sha: SHA_A, evidence: "run:1" },
      { id: "typecheck", command: "npm run typecheck", required: true, status: "ci_pass", sha: SHA_A, evidence: "run:1" },
      { id: "unit-contract-safety", command: "npx vitest run", required: true, status: "ci_pass", sha: SHA_A, evidence: "run:1" },
      { id: "eval-gate", command: "npm run eval", required: true, status: "ci_pass", sha: SHA_A, evidence: "run:1" },
      { id: "production-build", command: "npm run build", required: true, status: "ci_pass", sha: SHA_A, evidence: "run:1" },
      { id: "e2e-public", command: "npm run test:e2e:public", required: true, status: "ci_pass", sha: SHA_A, evidence: "run:1" },
      { id: "e2e-authenticated", command: "npm run test:e2e:matrix", required: true, status: "ci_pass", sha: SHA_A, evidence: "run:1" },
      { id: "release-check", command: "npm run release-check", required: true, status: "ci_pass", sha: SHA_A, evidence: "run:1" },
    ],
    blockers: [],
    acceptedRisks: [],
    verdicts: { automated_code_gate: "UNASSESSED", capped_beta: "UNASSESSED", public_paid: "UNASSESSED" },
    rollback: "target 6fe3980",
    ...overrides,
  };
}

const OWNER_ALL_GREEN = {
  authE2eAtCandidate: "observed",
  liveTransaction: "live_rehearsed",
  matureValue: "pass",
  openDependencyAdvisories: 0,
};

describe("deriveVerdicts computes from the gates", () => {
  it("a draft or unfrozen manifest is UNASSESSED across the board", () => {
    const v = deriveVerdicts(baseManifest({ candidateLifecycle: "draft", rcSha: null }));
    expect(v).toEqual({
      automated_code_gate: "UNASSESSED",
      capped_beta: "UNASSESSED",
      public_paid: "UNASSESSED",
    });
  });

  it("an invalid record (manifestValid=false) is UNASSESSED across the board", () => {
    const v = deriveVerdicts(baseManifest(), OWNER_ALL_GREEN, { manifestValid: false });
    expect(v.public_paid).toBe("UNASSESSED");
  });

  it("a superseded candidate is UNASSESSED across the board", () => {
    const v = deriveVerdicts(baseManifest({ candidateLifecycle: "superseded" }), OWNER_ALL_GREEN);
    expect(v.capped_beta).toBe("UNASSESSED");
  });

  it("all gates green + owner observations → GO on every tier", () => {
    const v = deriveVerdicts(baseManifest(), OWNER_ALL_GREEN);
    expect(v).toEqual({
      automated_code_gate: "GO",
      capped_beta: "GO",
      public_paid: "GO",
    });
  });

  it("no owner observations → code GO but tiers only CONDITIONAL/NO-GO", () => {
    const v = deriveVerdicts(baseManifest(), NO_OWNER_EVIDENCE);
    expect(v.automated_code_gate).toBe("GO");
    expect(v.capped_beta).toBe("CONDITIONAL GO"); // no blocker, but auth not observed
    expect(v.public_paid).toBe("CONDITIONAL GO"); // owner gates not observed
  });

  it("an unaccepted open blocker forces NO-GO for the tier it blocks", () => {
    const m = baseManifest({
      blockers: [{ id: "P0-X", level: "P0", title: "x", owner: "Eng", blocks: ["public_paid"], acceptance: "fix it" }],
    });
    const v = deriveVerdicts(m, OWNER_ALL_GREEN);
    expect(v.public_paid).toBe("NO-GO");
    expect(v.capped_beta).toBe("GO"); // not blocked for beta
  });

  it("an accepted open blocker permits CONDITIONAL GO, never GO", () => {
    const m = baseManifest({
      blockers: [{ id: "P0-X", level: "P0", title: "x", owner: "Owner", blocks: ["public_paid"], acceptance: "fix it" }],
      acceptedRisks: [{ blockerId: "P0-X", acceptedBy: "Primoz", acceptedOnUtc: "2026-08-11T00:00:00Z", tiers: ["public_paid"], rationale: "x" }],
    });
    const v = deriveVerdicts(m, OWNER_ALL_GREEN);
    expect(v.public_paid).toBe("CONDITIONAL GO");
  });

  it("a required suite that is not passing forces NO-GO on the release tiers", () => {
    const m = baseManifest();
    m.suites = m.suites.map((s) => (s.id === "e2e-authenticated" ? { ...s, status: "blocked" } : s));
    const v = deriveVerdicts(m, OWNER_ALL_GREEN);
    expect(v.capped_beta).toBe("NO-GO");
    expect(v.public_paid).toBe("NO-GO");
    expect(v.automated_code_gate).toBe("GO"); // owner gate, not a code gate
  });
});

describe("buildCandidate + validateCandidateArtifact enforce immutability", () => {
  const build = () =>
    buildCandidate(baseManifest(), {
      rcSha: SHA_A,
      runId: "run-1",
      runProvenance: "workflow",
      generatedAtUtc: "2026-08-11T00:00:00Z",
      environmentClass: "non_production",
      rollbackTarget: "6fe3980",
      suites: baseManifest().suites,
      evidenceHashes: {},
      gates: OWNER_ALL_GREEN,
      manifestValid: true,
    });

  it("a well-formed candidate passes validation", () => {
    const c = build();
    const problems = validateCandidateArtifact(c, baseManifest(), {
      expectHeadSha: SHA_A,
      gates: OWNER_ALL_GREEN,
    });
    expect(problems).toEqual([]);
    expect(c.candidateLifecycle).toBe("frozen");
    expect(c.verdicts.automated_code_gate).toBe("GO");
  });

  it("rejects a candidate that pins a different SHA than the checked-out HEAD", () => {
    const c = build();
    const problems = validateCandidateArtifact(c, baseManifest(), { expectHeadSha: SHA_B, gates: OWNER_ALL_GREEN });
    expect(problems.map((p) => p.rule)).toContain("wrong_sha");
  });

  it("rejects a tampered (hand-typed) verdict", () => {
    const c = build();
    c.verdicts.public_paid = "GO"; // force an active verdict the gates do not support here it already is GO, flip beta
    c.verdicts.capped_beta = "NO-GO";
    const problems = validateCandidateArtifact(c, baseManifest(), { expectHeadSha: SHA_A, gates: OWNER_ALL_GREEN });
    expect(problems.map((p) => p.rule)).toContain("verdict_mismatch");
  });

  it("rejects a bare local_pass in a workflow-frozen candidate", () => {
    const c = build();
    c.suites = c.suites.map((s: { id: string }) => (s.id === "lint" ? { ...s, status: "local_pass" } : s));
    // recompute verdicts so only the local_pass rule fires
    const problems = validateCandidateArtifact(c, baseManifest(), { expectHeadSha: SHA_A, gates: OWNER_ALL_GREEN });
    expect(problems.map((p) => p.rule)).toContain("local_pass_only");
  });

  it("rejects a candidate certified against production", () => {
    const c = build();
    c.environmentClass = "production";
    const problems = validateCandidateArtifact(c, baseManifest(), { expectHeadSha: SHA_A, gates: OWNER_ALL_GREEN });
    expect(problems.map((p) => p.rule)).toContain("environment");
  });
});
