import { describe, expect, it } from "vitest";
import {
  buildCandidate,
  classifySuite,
  deriveVerdicts,
  validateCandidateArtifact,
  NO_OWNER_EVIDENCE,
} from "../scripts/candidate-lib.mjs";

/**
 * MW-V17-02 established a SHA-pinned candidate whose verdicts are DERIVED, not
 * hand-typed. MW-V18-02 repairs the specific gap that a GREEN release-candidate
 * run — one where the authenticated matrix actually passed — could still freeze
 * beta/public as NO-GO because its auth pass was never recorded, and could only
 * reach a verdict by treating the production-only `release-check` as a suite an
 * RC might mark green.
 *
 * These tests pin the three evidence classes apart:
 *   - code suites drive ONLY the automated code gate,
 *   - the authenticated journey (recorded at the candidate) drives capped beta,
 *   - release-check + live money drive public paid, and a non-production
 *     candidate can never fabricate them.
 */

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

const CODE_IDS = [
  "lint",
  "typecheck",
  "unit-contract-safety",
  "eval-gate",
  "production-build",
  "e2e-public",
];

type SuiteOverride = {
  auth?: string; // status for e2e-authenticated (default ci_pass)
  releaseCheck?: string; // status for release-check (default blocked)
};

function suites({ auth = "ci_pass", releaseCheck = "blocked" }: SuiteOverride = {}) {
  const passing = ["local_pass", "ci_pass", "preview_pass", "live_rehearsed", "observed"];
  const mk = (id: string, status: string, cmd: string) => {
    const rec: Record<string, unknown> = { id, command: cmd, required: true, status };
    if (passing.includes(status)) {
      rec.sha = SHA_A;
      rec.evidence = id === "e2e-authenticated" ? "docs/release/evidence/auth.json" : "run:1";
    }
    return rec;
  };
  return [
    ...CODE_IDS.map((id) => mk(id, "ci_pass", `npm run ${id}`)),
    mk("e2e-authenticated", auth, "npm run test:e2e:matrix"),
    mk("release-check", releaseCheck, "npm run release-check"),
  ];
}

function baseManifest(overrides: Record<string, unknown> = {}, suiteOpts?: SuiteOverride) {
  return {
    release: "v18",
    baselineSha: SHA_B,
    rcSha: SHA_A,
    candidateLifecycle: "frozen",
    migrations: ["001", "002", "003"],
    suites: suites(suiteOpts),
    blockers: [],
    acceptedRisks: [],
    verdicts: { automated_code_gate: "UNASSESSED", capped_beta: "UNASSESSED", public_paid: "UNASSESSED" },
    rollback: "target 6fe3980",
    ...overrides,
  };
}

/** Owner production evidence, everything green — the promote-time input. */
const OWNER_ALL_GREEN = {
  authE2eAtCandidate: "observed",
  liveTransaction: "live_rehearsed",
  matureValue: "pass",
  openDependencyAdvisories: 0,
};

describe("suite classification separates the three evidence classes", () => {
  it("maps ids to code / auth_journey / production_owner", () => {
    expect(classifySuite({ id: "lint" })).toBe("code");
    expect(classifySuite({ id: "e2e-public" })).toBe("code");
    expect(classifySuite({ id: "e2e-authenticated" })).toBe("auth_journey");
    expect(classifySuite({ id: "release-check" })).toBe("production_owner");
  });

  it("honors an explicit suiteClass over the id default", () => {
    expect(classifySuite({ id: "whatever", suiteClass: "production_owner" })).toBe("production_owner");
    expect(() => classifySuite({ id: "x", suiteClass: "bogus" })).toThrow();
  });
});

describe("deriveVerdicts — the MW-V18-02 gap", () => {
  it("THE FIX: recording the auth journey flips beta off NO-GO (no blocker involved)", () => {
    // Not recorded → beta NO-GO purely because the auth suite is not passing.
    const notRecorded = deriveVerdicts(baseManifest({}, { auth: "blocked" }));
    expect(notRecorded.capped_beta).toBe("NO-GO");
    // Recorded at the candidate → beta is no longer NO-GO. This is the exact
    // "green RC must not freeze NO-GO solely because its auth pass was unrecorded".
    const recorded = deriveVerdicts(baseManifest({}, { auth: "ci_pass" }));
    expect(recorded.capped_beta).toBe("GO");
    expect(recorded.automated_code_gate).toBe("GO");
  });

  it("beta does NOT depend on release-check (production owner evidence)", () => {
    // Auth recorded, release-check still blocked (a non-production RC leaves it
    // blocked): beta may still be GO. Before the fix this was NO-GO.
    const v = deriveVerdicts(baseManifest({}, { auth: "ci_pass", releaseCheck: "blocked" }));
    expect(v.capped_beta).toBe("GO");
  });

  it("paid REQUIRES release-check to have passed — a non-production candidate cannot claim it", () => {
    // release-check blocked → paid NO-GO no matter how much else is green.
    const v = deriveVerdicts(baseManifest({}, { auth: "ci_pass", releaseCheck: "blocked" }), OWNER_ALL_GREEN);
    expect(v.public_paid).toBe("NO-GO");
  });

  it("paid reaches GO only with release-check passing AND owner live/value evidence", () => {
    const v = deriveVerdicts(baseManifest({}, { auth: "ci_pass", releaseCheck: "ci_pass" }), OWNER_ALL_GREEN);
    expect(v).toEqual({ automated_code_gate: "GO", capped_beta: "GO", public_paid: "GO" });
  });

  it("release-check passing but no live money → paid degrades to CONDITIONAL, not GO", () => {
    const v = deriveVerdicts(baseManifest({}, { auth: "ci_pass", releaseCheck: "ci_pass" }), NO_OWNER_EVIDENCE);
    expect(v.public_paid).toBe("CONDITIONAL GO");
    expect(v.capped_beta).toBe("GO");
  });

  it("automated_code_gate never depends on the auth or production gates", () => {
    const v = deriveVerdicts(baseManifest({}, { auth: "blocked", releaseCheck: "blocked" }));
    expect(v.automated_code_gate).toBe("GO"); // code suites all pass
    expect(v.capped_beta).toBe("NO-GO");
    expect(v.public_paid).toBe("NO-GO");
  });

  it("a failing code suite forces the code gate (and everything) to NO-GO", () => {
    const m = baseManifest();
    m.suites = m.suites.map((s) => (s.id === "lint" ? { ...s, status: "failed", sha: undefined, evidence: undefined } : s));
    const v = deriveVerdicts(m, OWNER_ALL_GREEN);
    expect(v.automated_code_gate).toBe("NO-GO");
    expect(v.capped_beta).toBe("NO-GO");
  });
});

describe("deriveVerdicts — lifecycle and blockers", () => {
  it("a draft or unfrozen manifest is UNASSESSED across the board", () => {
    const v = deriveVerdicts(baseManifest({ candidateLifecycle: "draft", rcSha: null }));
    expect(v).toEqual({ automated_code_gate: "UNASSESSED", capped_beta: "UNASSESSED", public_paid: "UNASSESSED" });
  });

  it("an invalid record (manifestValid=false) is UNASSESSED across the board", () => {
    const v = deriveVerdicts(baseManifest({}, { releaseCheck: "ci_pass" }), OWNER_ALL_GREEN, { manifestValid: false });
    expect(v.public_paid).toBe("UNASSESSED");
  });

  it("a superseded candidate is UNASSESSED across the board", () => {
    const v = deriveVerdicts(baseManifest({ candidateLifecycle: "superseded" }), OWNER_ALL_GREEN);
    expect(v.capped_beta).toBe("UNASSESSED");
  });

  it("an unaccepted open blocker forces NO-GO for the tier it blocks", () => {
    const m = baseManifest(
      { blockers: [{ id: "P0-X", level: "P0", title: "x", owner: "Eng", blocks: ["public_paid"], acceptance: "fix it" }] },
      { releaseCheck: "ci_pass" },
    );
    const v = deriveVerdicts(m, OWNER_ALL_GREEN);
    expect(v.public_paid).toBe("NO-GO");
    expect(v.capped_beta).toBe("GO"); // not blocked for beta
  });

  it("an accepted open blocker permits CONDITIONAL GO, never GO", () => {
    const m = baseManifest(
      {
        blockers: [{ id: "P0-X", level: "P0", title: "x", owner: "Owner", blocks: ["public_paid"], acceptance: "fix it" }],
        acceptedRisks: [{ blockerId: "P0-X", acceptedBy: "Primoz", acceptedOnUtc: "2026-08-11T00:00:00Z", tiers: ["public_paid"], rationale: "x" }],
      },
      { releaseCheck: "ci_pass" },
    );
    const v = deriveVerdicts(m, OWNER_ALL_GREEN);
    expect(v.public_paid).toBe("CONDITIONAL GO");
  });
});

describe("buildCandidate + validateCandidateArtifact enforce immutability + honesty", () => {
  const build = (suiteOpts?: SuiteOverride, gates = OWNER_ALL_GREEN) =>
    buildCandidate(baseManifest({}, suiteOpts), {
      rcSha: SHA_A,
      runId: "run-1",
      runProvenance: "workflow",
      generatedAtUtc: "2026-08-11T00:00:00Z",
      environmentClass: "non_production",
      rollbackTarget: "6fe3980",
      suites: suites(suiteOpts),
      evidenceHashes: {},
      gates,
      manifestValid: true,
    });

  it("a well-formed non-production candidate (release-check blocked) passes validation", () => {
    const c = build();
    const problems = validateCandidateArtifact(c, baseManifest(), { expectHeadSha: SHA_A, gates: OWNER_ALL_GREEN });
    expect(problems).toEqual([]);
    expect(c.candidateLifecycle).toBe("frozen");
    expect(c.verdicts.automated_code_gate).toBe("GO");
    expect(c.verdicts.public_paid).toBe("NO-GO"); // release-check not run in a non-prod RC
  });

  it("REFUSES a production-owner suite marked passing in a non-production candidate", () => {
    const c = build({ releaseCheck: "ci_pass" });
    const problems = validateCandidateArtifact(c, baseManifest({}, { releaseCheck: "ci_pass" }), {
      expectHeadSha: SHA_A,
      gates: OWNER_ALL_GREEN,
    });
    expect(problems.map((p) => p.rule)).toContain("production_gate_faked");
  });

  it("rejects a candidate that pins a different SHA than the checked-out HEAD", () => {
    const c = build();
    const problems = validateCandidateArtifact(c, baseManifest(), { expectHeadSha: SHA_B, gates: OWNER_ALL_GREEN });
    expect(problems.map((p) => p.rule)).toContain("wrong_sha");
  });

  it("rejects a tampered (hand-typed) verdict", () => {
    const c = build();
    c.verdicts.capped_beta = "NO-GO"; // gates support GO here
    const problems = validateCandidateArtifact(c, baseManifest(), { expectHeadSha: SHA_A, gates: OWNER_ALL_GREEN });
    expect(problems.map((p) => p.rule)).toContain("verdict_mismatch");
  });

  it("rejects a bare local_pass in a workflow-frozen candidate", () => {
    const c = build();
    c.suites = c.suites.map((s: { id: string }) => (s.id === "lint" ? { ...s, status: "local_pass" } : s));
    const problems = validateCandidateArtifact(c, baseManifest(), { expectHeadSha: SHA_A, gates: OWNER_ALL_GREEN });
    expect(problems.map((p) => p.rule)).toContain("local_pass_only");
  });

  it("rejects a candidate certified against production", () => {
    const c = build();
    c.environmentClass = "production";
    const problems = validateCandidateArtifact(c, baseManifest(), { expectHeadSha: SHA_A, gates: OWNER_ALL_GREEN });
    expect(problems.map((p) => p.rule)).toContain("environment");
  });

  it("rejects a passing suite whose sha is not the candidate sha (partial/stale)", () => {
    const c = build();
    c.suites = c.suites.map((s: { id: string }) => (s.id === "e2e-public" ? { ...s, sha: SHA_B } : s));
    const problems = validateCandidateArtifact(c, baseManifest(), { expectHeadSha: SHA_A, gates: OWNER_ALL_GREEN });
    expect(problems.map((p) => p.rule)).toContain("wrong_sha");
  });
});
