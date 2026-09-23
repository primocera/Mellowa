import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deriveVerdicts,
  deriveScaleExpansion,
  validateAuditArtifact,
  AUDIT_FRESHNESS_MAX_AGE_HOURS,
} from "../scripts/candidate-lib.mjs";
import {
  validateReleaseManifest,
  type ReleaseManifest,
} from "@/lib/release/manifest";

/**
 * v23 (WS-B + WS-C) — the dependency audit is a REAL gate, and mature customer
 * value is split OUT of the paid MVP into a separate scale-expansion verdict.
 *
 * These tests pin the exact failure modes the release line removes:
 *  - a non-zero (or unavailable / stale / wrong-SHA / corrupt / missing) audit can
 *    never let a candidate read public-paid GO, and is never silently read as 0;
 *  - matureValue "absent" does NOT block a bounded/supervised paid MVP, but it does
 *    hold scale expansion at GATHERING DATA (and a real cohort "pass" is required to
 *    lift it).
 */

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const NOW = "2026-09-21T00:00:00Z";

/** A frozen manifest whose code + auth + production gates are all green. */
function greenManifest() {
  const passing = (id: string, cls?: string): Record<string, unknown> => ({
    id,
    command: `run ${id}`,
    required: true,
    status: "ci_pass",
    sha: SHA_A,
    evidence: "run:1",
    ...(cls ? { suiteClass: cls } : {}),
  });
  return {
    release: "v23-test",
    baselineSha: SHA_B,
    rcSha: SHA_A,
    candidateLifecycle: "frozen",
    migrations: ["001"],
    suites: [
      passing("lint"),
      passing("typecheck"),
      passing("unit-contract-safety"),
      passing("eval-gate"),
      passing("production-build"),
      passing("e2e-public"),
      passing("e2e-authenticated", "auth_journey"),
      passing("release-check", "production_owner"),
    ],
    blockers: [],
    acceptedRisks: [],
    verdicts: { automated_code_gate: "UNASSESSED", capped_beta: "UNASSESSED", public_paid: "UNASSESSED" },
    rollback: "target 6fe3980",
  };
}

/** Owner evidence with paid gates green EXCEPT the two under test. */
const paidGates = (over: Record<string, unknown> = {}) => ({
  authE2eAtCandidate: "observed",
  liveTransaction: "live_rehearsed",
  matureValue: "absent",
  openDependencyAdvisories: 0,
  ...over,
});

/** A well-formed clean audit artifact pinned to SHA_A, observed just now. */
const cleanAudit = (over: Record<string, unknown> = {}) => ({
  schema: 1,
  application: "mellowa",
  candidateSha: SHA_A,
  command: "npm audit --omit=dev --json",
  observedAtUtc: NOW,
  status: "clean",
  counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
  ...over,
});

describe("the dependency audit is a real paid gate (WS-B)", () => {
  it("a clean, fresh, SHA-matched artifact yields openAdvisories 0 and lets paid read GO", () => {
    const { problems, openAdvisories } = validateAuditArtifact(cleanAudit(), {
      expectSha: SHA_A,
      nowUtc: NOW,
    });
    expect(problems).toEqual([]);
    expect(openAdvisories).toBe(0);
    const v = deriveVerdicts(greenManifest(), paidGates({ openDependencyAdvisories: openAdvisories }));
    expect(v.public_paid).toBe("GO");
  });

  it("NON-ZERO audit findings can never reach public-paid GO", () => {
    const audit = cleanAudit({
      status: "findings",
      counts: { info: 0, low: 0, moderate: 1, high: 1, critical: 1, total: 3 },
    });
    const { problems, openAdvisories } = validateAuditArtifact(audit, { expectSha: SHA_A, nowUtc: NOW });
    expect(problems).toEqual([]); // well-formed, but it HAS findings
    expect(openAdvisories).toBe(3);
    const v = deriveVerdicts(greenManifest(), paidGates({ openDependencyAdvisories: 3 }));
    expect(v.public_paid).not.toBe("GO");
  });

  it("a MISSING artifact is unknown (null), never 0 — paid cannot read GO", () => {
    const { problems, openAdvisories } = validateAuditArtifact(null, { expectSha: SHA_A, nowUtc: NOW });
    expect(problems.map((p) => p.rule)).toContain("corrupt");
    expect(openAdvisories).toBeNull();
    const v = deriveVerdicts(greenManifest(), paidGates({ openDependencyAdvisories: openAdvisories }));
    expect(v.public_paid).not.toBe("GO");
  });

  it("an UNAVAILABLE audit blocks — it is never converted to 0 advisories", () => {
    const audit = cleanAudit({ status: "unavailable", reason: "registry unreachable" });
    const { problems, openAdvisories } = validateAuditArtifact(audit, { expectSha: SHA_A, nowUtc: NOW });
    expect(problems.map((p) => p.rule)).toContain("unavailable");
    expect(openAdvisories).toBeNull();
  });

  it("a STALE artifact (beyond the freshness window) is rejected", () => {
    const old = new Date(Date.parse(NOW) - (AUDIT_FRESHNESS_MAX_AGE_HOURS + 24) * 3_600_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    const { problems } = validateAuditArtifact(cleanAudit({ observedAtUtc: old }), {
      expectSha: SHA_A,
      nowUtc: NOW,
    });
    expect(problems.map((p) => p.rule)).toContain("stale");
  });

  it("a WRONG-SHA artifact never carries across commits", () => {
    const { problems } = validateAuditArtifact(cleanAudit({ candidateSha: SHA_B }), {
      expectSha: SHA_A,
      nowUtc: NOW,
    });
    expect(problems.map((p) => p.rule)).toContain("wrong_sha");
  });

  it("a CORRUPT artifact (counts that do not add up, or a lying status) is rejected", () => {
    const badCounts = validateAuditArtifact(
      cleanAudit({ counts: { info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 0 } }),
      { expectSha: SHA_A, nowUtc: NOW },
    );
    expect(badCounts.problems.map((p) => p.rule)).toContain("corrupt");
    const lyingStatus = validateAuditArtifact(
      cleanAudit({ status: "clean", counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 2, total: 2 } }),
      { expectSha: SHA_A, nowUtc: NOW },
    );
    expect(lyingStatus.problems.map((p) => p.rule)).toContain("corrupt");
  });
});

describe("matureValue is split OUT of the paid MVP into scale expansion (WS-C)", () => {
  it("matureValue 'absent' does NOT block a bounded/supervised paid MVP", () => {
    const v = deriveVerdicts(greenManifest(), paidGates({ matureValue: "absent" }));
    expect(v.public_paid).toBe("GO"); // paid is GO without any cohort report
    expect(v.capped_beta).toBe("GO");
  });

  it("but scale expansion stays GATHERING DATA until a real cohort report exists", () => {
    const gates = paidGates({ matureValue: "absent" });
    expect(deriveScaleExpansion(greenManifest(), gates)).toBe("GATHERING DATA");
  });

  it("a mature cohort 'pass' lifts scale expansion to follow the paid verdict", () => {
    const gates = paidGates({ matureValue: "pass" });
    expect(deriveVerdicts(greenManifest(), gates).public_paid).toBe("GO");
    expect(deriveScaleExpansion(greenManifest(), gates)).toBe("GO");
  });

  it("a cohort 'fail' makes scale expansion NO-GO even when paid is GO", () => {
    const gates = paidGates({ matureValue: "fail" });
    expect(deriveVerdicts(greenManifest(), gates).public_paid).toBe("GO");
    expect(deriveScaleExpansion(greenManifest(), gates)).toBe("NO-GO");
  });

  it("scale can never be more ready than paid: paid NO-GO → scale NO-GO", () => {
    // release-check blocked → paid NO-GO, so scale cannot ship regardless of cohort.
    const m = greenManifest();
    m.suites = m.suites.map((s) =>
      s.id === "release-check" ? { id: s.id, command: s.command, required: true, status: "blocked", suiteClass: "production_owner" } : s,
    );
    const gates = paidGates({ matureValue: "pass" });
    expect(deriveVerdicts(m, gates).public_paid).toBe("NO-GO");
    expect(deriveScaleExpansion(m, gates)).toBe("NO-GO");
  });
});

describe("the reconciled v22 manifest is internally consistent and honest", () => {
  const m = JSON.parse(readFileSync("docs/release/manifest.v22.json", "utf8")) as ReleaseManifest;

  it("validates with zero violations", () => {
    const violations = validateReleaseManifest(m);
    expect(
      violations,
      `v22 manifest violations: ${violations.map((v) => `${v.rule}: ${v.message}`).join(" | ")}`,
    ).toEqual([]);
  });

  it("is PROMOTED at the v24 final SHA with exact-SHA deploy parity and scale held at GATHERING DATA", () => {
    // v24 recertification: RC run 35814658356 froze 2543a38, production /api/health and
    // authenticated paid readiness were observed at the same SHA (2026-09-23).
    const F = "2543a38a41cb6689b17acc9cc1d96059b785e774";
    expect(m.candidateLifecycle).toBe("promoted");
    expect((m as { supersededNote?: string }).supersededNote).toBeUndefined();
    expect(m.rcSha).toBe(F);
    expect(m.buildId).toBe(F);
    for (const s of m.suites) expect(s.sha, s.id).toBe(F);
    expect(m.blockers.map((b) => b.id)).not.toContain("P0-V24-DEPLOY-PARITY");
    expect((m.closedBlockers ?? []).map((b) => b.id)).toContain("P0-V24-DEPLOY-PARITY");
    // Scale expansion is kept separate and non-active without a cohort report.
    expect(m.scaleExpansion).toBe("GATHERING DATA");
  });

  it("no longer hand-types matureValue=pass or openDependencyAdvisories in owner evidence", () => {
    const oe = JSON.parse(readFileSync("docs/release/v22/owner-evidence.v22.json", "utf8"));
    expect(oe.matureValue).toBe("absent"); // never a fabricated pass
    expect(oe.openDependencyAdvisories).toBeUndefined(); // proven by the audit artifact, not typed
  });

  it("makes the dependency audit a required, artifact-backed gate with a freshness instant", () => {
    const audit = m.suites.find((s) => s.id === "dependency-audit");
    expect(audit?.required).toBe(true);
    expect(audit?.status).toBe("ci_pass"); // proven by the SHA-pinned RC audit artifact
    expect(audit?.observedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});
