import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deriveVerdicts,
  deriveScaleExpansion,
  validateAuditArtifact,
} from "../scripts/candidate-lib.mjs";
import { validateReleaseManifest, type ReleaseManifest } from "@/lib/release/manifest";
import { ACTIVE_MANIFEST_PATH, ACTIVE_STATUS_PATH } from "../scripts/active-manifest.mjs";

/**
 * v24 WS-D — the six release-truth fail-conditions Prompt 2 D enumerates. Each is a
 * defect the reconciliation removes; the test proves the machinery refuses it and
 * that the real active manifest/docs are consistent under the same rules.
 */

const read = (p: string) => readFileSync(p, "utf8");
const short = (s: string) => s.slice(0, 7);
const SHA_1B7 = "1b7dfef83eec9570774254a8234f057c6e673a7b";
const SHA_F0D = "f0dbcf56fe648864bb6fcb9e5acab920af6be629";
const SHA_A = "a".repeat(40);
const NOW = "2026-09-21T00:00:00Z";

const activeManifest = () =>
  JSON.parse(read(ACTIVE_MANIFEST_PATH)) as ReleaseManifest & {
    supersededNote?: string;
    productHeadSha?: string;
  };

/** A frozen manifest whose code + auth + production gates are all green. */
function greenFrozen(includeIds?: string[]) {
  const ids = includeIds ?? [
    "lint",
    "typecheck",
    "unit-contract-safety",
    "eval-gate",
    "production-build",
    "dependency-audit",
    "e2e-public",
    "e2e-authenticated",
    "release-check",
  ];
  const suite = (id: string) => ({
    id,
    command: `run ${id}`,
    required: true,
    status: "ci_pass",
    sha: SHA_A,
    evidence: "run:1",
    ...(id === "e2e-authenticated" ? { suiteClass: "auth_journey" } : {}),
    ...(id === "release-check" ? { suiteClass: "production_owner" } : {}),
  });
  return {
    release: "v24-test",
    baselineSha: "b".repeat(40),
    rcSha: SHA_A,
    candidateLifecycle: "frozen",
    migrations: ["001"],
    suites: ids.map(suite),
    blockers: [],
    acceptedRisks: [],
    verdicts: { automated_code_gate: "UNASSESSED", capped_beta: "UNASSESSED", public_paid: "UNASSESSED" },
    rollback: "target 6fe3980",
  };
}

const paidGates = (over: Record<string, unknown> = {}) => ({
  authE2eAtCandidate: "observed",
  liveTransaction: "live_rehearsed",
  matureValue: "absent",
  openDependencyAdvisories: 0,
  ...over,
});

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

/** D.1 — a public-paid GO is dishonest unless the deployed health version matches rcSha. */
function deployParityProblem(
  m: { verdicts: { public_paid: string }; rcSha: string | null },
  deployedHealthVersion: string | null,
): string | null {
  if (m.verdicts.public_paid !== "GO") return null; // only a GO makes the parity claim
  if (!m.rcSha || !deployedHealthVersion) return "public-paid GO with no pinned rcSha / deployed version";
  return short(m.rcSha) === short(deployedHealthVersion)
    ? null
    : `public-paid GO but rcSha ${short(m.rcSha)} != deployed health ${short(deployedHealthVersion)}`;
}

describe("v24 release-truth: the six fail-conditions", () => {
  it("(1) fails a public-paid GO whose rcSha != deployed /api/health version", () => {
    // GO at 1b7dfef while production serves f0dbcf5 — the exact drift v24 caught.
    expect(deployParityProblem({ verdicts: { public_paid: "GO" }, rcSha: SHA_1B7 }, SHA_F0D)).toBeTruthy();
    // Matching SHA → no problem.
    expect(deployParityProblem({ verdicts: { public_paid: "GO" }, rcSha: SHA_1B7 }, SHA_1B7)).toBeNull();
    // The REAL active manifest is superseded (not GO), so it makes no parity claim and
    // is honest even though the deployed version differs.
    const m = activeManifest();
    expect(m.verdicts.public_paid).not.toBe("GO");
    expect(deployParityProblem(m, SHA_F0D)).toBeNull();
  });

  it("(2) a candidate missing a required active-line suite cannot read that tier GO", () => {
    const m = activeManifest();
    const required = m.suites.filter((s) => s.required).map((s) => s.id);
    // The active line's required suites include the v23 dependency-audit gate + auth.
    expect(required).toContain("dependency-audit");
    expect(required).toContain("e2e-authenticated");
    // Drop the authenticated journey (and withhold the auth owner-gate, so the only
    // possible source of "auth observed" is the missing suite) → beta cannot read GO.
    const noAuth = greenFrozen(required.filter((id) => id !== "e2e-authenticated"));
    expect(deriveVerdicts(noAuth, paidGates({ authE2eAtCandidate: "not_run" })).capped_beta).not.toBe("GO");
  });

  it("(3) a missing / stale / wrong-SHA / unavailable / findings audit never reads clean → paid not GO", () => {
    const opts = { expectSha: SHA_A, nowUtc: NOW };
    expect(validateAuditArtifact(null, opts).openAdvisories).toBeNull(); // missing
    expect(validateAuditArtifact(cleanAudit({ candidateSha: "c".repeat(40) }), opts).openAdvisories).toBeNull(); // wrong SHA
    expect(validateAuditArtifact(cleanAudit({ observedAtUtc: "2026-01-01T00:00:00Z" }), opts).openAdvisories).toBeNull(); // stale
    expect(validateAuditArtifact(cleanAudit({ status: "unavailable", reason: "registry down" }), opts).openAdvisories).toBeNull(); // unavailable
    const findings = validateAuditArtifact(
      cleanAudit({ status: "findings", counts: { info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1 } }),
      opts,
    );
    expect(findings.openAdvisories).toBe(1); // findings → never silently 0
    for (const adv of [null, 1] as const) {
      expect(deriveVerdicts(greenFrozen(), paidGates({ openDependencyAdvisories: adv })).public_paid).not.toBe("GO");
    }
  });

  it("(4) the owner checklist never claims all steps executed while its table reads NOT RUN", () => {
    const doc = read("docs/release/v23/OWNER-CHECKLIST.md");
    const claimsAllExecuted =
      /all owner steps[^\n]*\b(were run|executed)\b/i.test(doc) ||
      /\bEXECUTED\b[^\n]*all owner steps/i.test(doc);
    const tableHasNotRun = /\bNOT RUN\b/.test(doc);
    expect(claimsAllExecuted && tableHasNotRun, "checklist claims all-executed while rows read NOT RUN").toBe(false);
  });

  it("(5) no active certification contradicts the generated STATUS's verdict / SHA", () => {
    const m = activeManifest();
    const status = read(ACTIVE_STATUS_PATH);
    const finalClosure = read("docs/release/v22/MELLOWA-FINAL-CLOSURE-CERTIFICATION.md");
    const v23cert = read("docs/release/v23/CERTIFICATION.md");
    const superseded = m.candidateLifecycle === "superseded" || Boolean(m.supersededNote);

    // STATUS is rendered from the manifest, so it carries the same candidate SHA.
    expect(status).toContain(short(m.rcSha!));

    if (superseded) {
      // Every active verdict-bearing doc must say SUPERSEDED and pin the same rcSha —
      // no doc may still present the old verdict as current.
      for (const [name, doc] of [
        ["STATUS", status],
        ["final-closure", finalClosure],
        ["v23-cert", v23cert],
      ] as const) {
        expect(doc, `${name} omits SUPERSEDED`).toMatch(/SUPERSEDED/i);
        expect(doc, `${name} names a different rcSha`).toContain(short(m.rcSha!));
      }
      // The certs state the current verdict as PENDING / UNASSESSED, never a bare current GO.
      for (const [name, doc] of [
        ["final-closure", finalClosure],
        ["v23-cert", v23cert],
      ] as const) {
        expect(
          /PENDING OWNER RECERTIFICATION|UNASSESSED/.test(doc),
          `${name} does not state the current PENDING/UNASSESSED verdict`,
        ).toBe(true);
      }
    }
  });

  it("(6) scale expansion is kept separate from the paid MVP", () => {
    // A bounded paid MVP is approvable with matureValue absent, while scale stays GATHERING DATA.
    const g = greenFrozen();
    expect(deriveVerdicts(g, paidGates({ matureValue: "absent" })).public_paid).toBe("GO");
    expect(deriveScaleExpansion(g, paidGates({ matureValue: "absent" }))).toBe("GATHERING DATA");
    // A real cohort pass lifts scale to follow paid; a fail sinks it — proof they are separate.
    expect(deriveScaleExpansion(g, paidGates({ matureValue: "pass" }))).toBe("GO");
    expect(deriveScaleExpansion(g, paidGates({ matureValue: "fail" }))).toBe("NO-GO");
    // The real active manifest keeps scale non-active while paid is not GO.
    const m = activeManifest();
    expect(m.scaleExpansion).toBe("GATHERING DATA");
    expect(["GO", "CONDITIONAL GO"]).not.toContain(m.verdicts.public_paid);
  });

  it("the active manifest itself validates with zero violations", () => {
    const violations = validateReleaseManifest(activeManifest());
    expect(
      violations,
      `active manifest violations: ${violations.map((v) => `${v.rule}: ${v.message}`).join(" | ")}`,
    ).toEqual([]);
  });
});
