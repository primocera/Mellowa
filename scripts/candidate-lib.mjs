/**
 * Immutable release-candidate record + computed verdicts (MW-V17-02).
 *
 * The gap this closes: the release-candidate workflow checked a SHA but then
 * uploaded the UNCHANGED draft manifest as "evidence", and the manifest's three
 * verdicts were hand-typed. So nothing proved a workflow had frozen the exact
 * candidate, and a human could type GO next to a gate that never ran.
 *
 * This module makes the candidate a COMPUTED artifact. Pure ESM (no TS, no
 * filesystem) so `scripts/freeze-candidate.mjs` runs it under plain `node` in the
 * workflow and `tests/candidate-lifecycle.test.ts` imports it directly — the same
 * pattern as `scripts/render-release-status.mjs`.
 *
 * Verdict validity is an INPUT (`manifestValid`), not recomputed here: the RC
 * workflow validates the manifest first (`npm run release-manifest`) and only
 * then freezes, so the caller already knows. The contract test passes it too.
 */

/** Statuses that assert something actually passed. Mirror of manifest.ts. */
export const PASSING_STATUSES = [
  "local_pass",
  "ci_pass",
  "preview_pass",
  "live_rehearsed",
  "observed",
];
export const isPassing = (status) => PASSING_STATUSES.includes(status);

const ACTIVE_VERDICTS = ["GO", "CONDITIONAL GO"];
export const isActiveVerdict = (v) => ACTIVE_VERDICTS.includes(v);

export const CANDIDATE_ARTIFACT_SCHEMA = 1;

const SHA_RE = /^[0-9a-f]{40}$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** The honest default: nothing owner-run has been observed. */
export const NO_OWNER_EVIDENCE = {
  authE2eAtCandidate: "not_run",
  liveTransaction: "not_run",
  matureValue: "absent",
  openDependencyAdvisories: 0,
};

/** Owner-run suites, so the code gate never depends on an owner gate. */
function isOwnerGate(suiteId) {
  return suiteId === "e2e-authenticated" || suiteId === "release-check";
}

/**
 * Compute the three verdicts from the gates. Non-compensating, mirroring the
 * readiness rubric:
 *  - invalid record, no frozen candidate, or superseded → UNASSESSED everywhere.
 *  - an open P0/P1 blocking a tier with no accepted risk → NO-GO for it.
 *  - an accepted open blocker → CONDITIONAL GO, never GO.
 *  - a required suite not passing → NO-GO on the release tiers.
 *  - GO also needs the tier's owner observations (auth E2E for beta; auth E2E +
 *    live money + mature value + no dependency advisory for paid).
 */
export function deriveVerdicts(manifest, gates = NO_OWNER_EVIDENCE, { manifestValid = true } = {}) {
  const lifecycle = manifest.candidateLifecycle ?? (manifest.rcSha ? "frozen" : "draft");
  const frozen =
    manifest.rcSha != null && (lifecycle === "frozen" || lifecycle === "promoted");
  const superseded =
    lifecycle === "superseded" || Boolean((manifest.supersededNote ?? "").trim());

  if (!manifestValid || superseded || !frozen) {
    return {
      automated_code_gate: "UNASSESSED",
      capped_beta: "UNASSESSED",
      public_paid: "UNASSESSED",
    };
  }

  const requiredSuites = manifest.suites.filter((s) => s.required);
  const codeSuites = requiredSuites.filter((s) => !isOwnerGate(s.id));
  const codeGreen = codeSuites.every((s) => isPassing(s.status));
  const allRequiredGreen = requiredSuites.every((s) => isPassing(s.status));

  const openP0 = manifest.blockers.filter((b) => b.level === "P0");
  const openP1 = manifest.blockers.filter((b) => b.level === "P1");
  const acceptedFor = (id, tier) =>
    (manifest.acceptedRisks ?? []).some((r) => r.blockerId === id && r.tiers.includes(tier));

  const automated_code_gate = codeGreen ? "GO" : "NO-GO";

  const tierVerdict = (tier, ownerGatesObserved) => {
    let conditional = false;
    for (const b of [...openP0, ...openP1]) {
      if (!b.blocks.includes(tier)) continue;
      if (!acceptedFor(b.id, tier)) return "NO-GO";
      conditional = true;
    }
    if (!allRequiredGreen) return "NO-GO";
    if (!ownerGatesObserved) conditional = true;
    return conditional ? "CONDITIONAL GO" : "GO";
  };

  const betaObserved = isPassing(gates.authE2eAtCandidate);
  const paidObserved =
    isPassing(gates.authE2eAtCandidate) &&
    isPassing(gates.liveTransaction) &&
    gates.matureValue === "pass" &&
    (gates.openDependencyAdvisories ?? 0) === 0;

  return {
    automated_code_gate,
    capped_beta: tierVerdict("capped_beta", betaObserved),
    public_paid: tierVerdict("public_paid", paidObserved),
  };
}

/**
 * Assemble a SHA-pinned candidate record from a base manifest + run provenance.
 * Verdicts are always derived, never passed in.
 */
export function buildCandidate(manifest, opts) {
  const m = manifest.migrations;
  return {
    schema: CANDIDATE_ARTIFACT_SCHEMA,
    release: manifest.release,
    rcSha: opts.rcSha,
    baselineSha: manifest.baselineSha,
    candidateLifecycle: "frozen",
    runId: opts.runId,
    runProvenance: opts.runProvenance,
    generatedAtUtc: opts.generatedAtUtc,
    environmentClass: opts.environmentClass,
    migrationRange: { first: m[0], last: m[m.length - 1], count: m.length },
    rollbackTarget: opts.rollbackTarget,
    suites: opts.suites,
    evidenceHashes: opts.evidenceHashes,
    // Verdicts derive from the CANDIDATE's own recorded suite results (what the
    // run actually observed at this SHA), not the base manifest's draft statuses.
    verdicts: deriveVerdicts(
      { ...manifest, suites: opts.suites, rcSha: opts.rcSha, candidateLifecycle: "frozen" },
      opts.gates,
      { manifestValid: opts.manifestValid ?? true },
    ),
  };
}

/**
 * Validate a candidate artifact for immutability and honesty.
 *  - pins a real 40-char SHA; must equal `expectHeadSha` when given.
 *  - stored verdicts must equal the derived ones (no hand-typing).
 *  - a workflow-frozen required suite cannot rest on a bare local_pass.
 *  - every passing suite references evidence; a named artifact hash must resolve.
 */
export function validateCandidateArtifact(candidate, manifest, opts = {}) {
  const problems = [];
  const fail = (rule, message) => problems.push({ rule, message });

  if (candidate.schema !== CANDIDATE_ARTIFACT_SCHEMA) {
    fail("malformed", `unknown candidate schema ${String(candidate.schema)}`);
  }
  if (!SHA_RE.test(candidate.rcSha)) {
    fail("wrong_sha", `rcSha is not a full 40-character SHA: ${candidate.rcSha}`);
  }
  if (opts.expectHeadSha && candidate.rcSha !== opts.expectHeadSha) {
    fail(
      "wrong_sha",
      `candidate pins ${candidate.rcSha.slice(0, 7)} but the checked-out HEAD is ` +
        `${opts.expectHeadSha.slice(0, 7)} — a candidate must freeze the exact commit`,
    );
  }
  if (!UTC_RE.test(candidate.generatedAtUtc)) {
    fail("malformed", `generatedAtUtc must be ISO 8601 UTC ending in Z: ${candidate.generatedAtUtc}`);
  }
  if (candidate.environmentClass === "production") {
    fail("environment", "a release candidate must be certified against a non-production environment");
  }

  const derived = deriveVerdicts(
    {
      ...manifest,
      suites: candidate.suites,
      rcSha: candidate.rcSha,
      candidateLifecycle: candidate.candidateLifecycle,
    },
    opts.gates,
    { manifestValid: opts.manifestValid ?? true },
  );
  for (const tier of ["automated_code_gate", "capped_beta", "public_paid"]) {
    if (candidate.verdicts[tier] !== derived[tier]) {
      fail(
        "verdict_mismatch",
        `${tier} verdict "${candidate.verdicts[tier]}" does not match the derived ` +
          `"${derived[tier]}" — verdicts are computed, not authored`,
      );
    }
  }

  for (const s of candidate.suites) {
    if (!s.required) continue;
    if (candidate.runProvenance === "workflow" && s.status === "local_pass") {
      fail(
        "local_pass_only",
        `required suite "${s.id}" is local_pass in a workflow-frozen candidate — ` +
          "a developer-machine pass cannot certify a workflow candidate",
      );
    }
    if (isPassing(s.status)) {
      if (!s.evidence || !String(s.evidence).trim()) {
        fail("missing_artifact", `passing suite "${s.id}" has no evidence reference`);
      } else if (s.artifactHash && !candidate.evidenceHashes[s.evidence]) {
        fail("missing_artifact", `suite "${s.id}" names evidence "${s.evidence}" not in evidenceHashes`);
      }
      if (s.sha && s.sha !== candidate.rcSha) {
        fail(
          "wrong_sha",
          `suite "${s.id}" passed at ${s.sha.slice(0, 7)} but the candidate is ${candidate.rcSha.slice(0, 7)}`,
        );
      }
    }
  }

  if (
    Object.values(candidate.verdicts).some(isActiveVerdict) &&
    candidate.candidateLifecycle !== "frozen" &&
    candidate.candidateLifecycle !== "promoted"
  ) {
    fail("malformed", "an active verdict requires a frozen or promoted candidate");
  }

  return problems;
}
