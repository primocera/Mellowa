#!/usr/bin/env node
/**
 * Promote a frozen release candidate into a REVIEWED manifest change (MW-V18-02).
 *
 * Freezing produces an immutable, SHA-pinned candidate artifact. Promotion is the
 * separate, human-reviewed step that adopts that artifact as the tracked release
 * truth. This tool does the machine-checkable verifications a reviewer would
 * otherwise do by eye, fails closed on any of them, and then writes a PROPOSED
 * manifest to a NEW file — it never overwrites the tracked manifest and never
 * hand-types a verdict (verdicts are derived). A person adopts the proposal via a
 * normal PR, at which point `tests/release-manifest.test.ts` re-validates it.
 *
 * Verifications (all must pass):
 *   1. The candidate artifact is internally valid (`validateCandidateArtifact`):
 *      real SHA, derived verdicts, no bare local_pass in a workflow candidate, no
 *      faked production-owner suite, evidence references present.
 *   2. Provenance: a promotion into the tracked manifest requires a WORKFLOW-frozen
 *      candidate (a local dry-run cannot be promoted).
 *   3. Evidence integrity: every recorded artifactHash re-hashes to the same value
 *      on disk (tamper detection).
 *   4. HEAD relationship: the candidate SHA must still describe HEAD — no
 *      product-code drift between rcSha..HEAD (else the candidate is superseded
 *      and must be re-cut).
 *   5. Non-superseded: the candidate lifecycle is `frozen`, and the base manifest
 *      is not itself superseded.
 *   6. Owner evidence (optional): if supplied it must be schema-valid and pinned
 *      to the candidate SHA. Promoting the public-paid tier to an active verdict
 *      requires it.
 *
 * Usage:
 *   node scripts/promote-candidate.mjs --candidate <path>
 *        [--owner-evidence <path>] [--manifest docs/release/manifest.v16.json]
 *        [--write [--out <path>]]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  classifySuite,
  deriveVerdicts,
  isActiveVerdict,
  isPassing,
  validateCandidateArtifact,
} from "./candidate-lib.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const problems = [];
const fail = (msg) => problems.push(msg);
const git = (a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const candidatePath = opt("--candidate");
if (!candidatePath || !existsSync(candidatePath)) {
  console.error(`--candidate <path> is required and must exist (got ${candidatePath ?? "none"}).`);
  process.exit(2);
}
const manifestPath = opt("--manifest", "docs/release/manifest.v16.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));

// ---- owner evidence (optional) ---------------------------------------------
const OWNER_EVIDENCE_SCHEMA = 1;
let gates; // undefined → candidate's recorded suites are the only evidence
const ownerEvidencePath = opt("--owner-evidence");
if (ownerEvidencePath) {
  if (!existsSync(ownerEvidencePath)) {
    fail(`owner evidence ${ownerEvidencePath} does not exist`);
  } else {
    let oe;
    try {
      oe = JSON.parse(readFileSync(ownerEvidencePath, "utf8"));
    } catch (err) {
      oe = null;
      fail(`owner evidence ${ownerEvidencePath} is not valid JSON: ${err.message}`);
    }
    if (oe) {
      if (oe.schema !== OWNER_EVIDENCE_SCHEMA) fail(`owner evidence has unknown schema ${String(oe.schema)}`);
      if (oe.sha !== candidate.rcSha) {
        fail(
          `owner evidence pins ${String(oe.sha).slice(0, 7)} but the candidate is ` +
            `${String(candidate.rcSha).slice(0, 7)} — owner evidence must be at the candidate SHA`,
        );
      }
      const statuses = ["not_run", "blocked", "skipped", "failed", "local_pass", "ci_pass", "preview_pass", "live_rehearsed", "observed"];
      for (const k of ["authE2eAtCandidate", "liveTransaction"]) {
        if (!statuses.includes(oe[k])) fail(`owner evidence field "${k}" has invalid status "${oe[k]}"`);
      }
      if (!["pass", "absent", "fail"].includes(oe.matureValue)) {
        fail(`owner evidence field "matureValue" must be pass|absent|fail (got "${oe.matureValue}")`);
      }
      if (!Number.isInteger(oe.openDependencyAdvisories) || oe.openDependencyAdvisories < 0) {
        fail(`owner evidence "openDependencyAdvisories" must be a non-negative integer`);
      }
      if (!oe.recordedBy || /^(owner|eng|team|tbd|n\/?a)$/i.test(String(oe.recordedBy).trim())) {
        fail(`owner evidence "recordedBy" must name a real person, not a role/placeholder`);
      }
      gates = {
        authE2eAtCandidate: oe.authE2eAtCandidate,
        liveTransaction: oe.liveTransaction,
        matureValue: oe.matureValue,
        openDependencyAdvisories: oe.openDependencyAdvisories,
      };
    }
  }
}

// ---- 1. candidate artifact validity ----------------------------------------
const artifactViolations = validateCandidateArtifact(candidate, manifest, {
  expectHeadSha: undefined, // HEAD relationship checked separately below
  gates,
  manifestValid: true,
});
for (const v of artifactViolations) fail(`invalid candidate [${v.rule}]: ${v.message}`);

// ---- 2. provenance ----------------------------------------------------------
if (candidate.runProvenance !== "workflow") {
  fail(
    `candidate provenance is "${candidate.runProvenance}" — only a workflow-frozen ` +
      "candidate can be promoted into the tracked manifest (a local dry-run cannot)",
  );
}

// ---- 3. evidence integrity (tamper detection) ------------------------------
for (const s of candidate.suites ?? []) {
  if (!s.artifactHash) continue;
  if (!existsSync(s.evidence)) {
    fail(`suite "${s.id}" names evidence ${s.evidence} which is missing on disk`);
    continue;
  }
  const actual = sha256(readFileSync(s.evidence));
  if (actual !== s.artifactHash) {
    fail(`suite "${s.id}" evidence ${s.evidence} has been tampered with (hash mismatch)`);
  }
  if (candidate.evidenceHashes && candidate.evidenceHashes[s.evidence] !== s.artifactHash) {
    fail(`suite "${s.id}" artifactHash disagrees with evidenceHashes map`);
  }
}

// ---- 4. HEAD relationship (no product-code drift) --------------------------
const head = git(["rev-parse", "HEAD"]);
if (candidate.rcSha !== head) {
  let diff = "";
  try {
    diff = git(["diff", "--name-only", candidate.rcSha, head]);
  } catch {
    fail(`cannot diff ${String(candidate.rcSha).slice(0, 7)}..${head.slice(0, 7)} — is the candidate SHA in this history?`);
  }
  const changed = diff ? diff.split("\n") : [];
  const productCode = changed.filter(
    (p) =>
      /^(src|app|e2e|scripts|tests|supabase|public|styles)\//.test(p) ||
      /^(package\.json|package-lock\.json|tsconfig\.json|next\.config\.(ts|mjs)|middleware\.ts|vitest\.config\.ts|playwright\.config\.ts|eslint\.config\.mjs)$/.test(p),
  );
  if (productCode.length > 0) {
    fail(
      `candidate ${String(candidate.rcSha).slice(0, 7)} is SUPERSEDED: ${productCode.length} ` +
        `product-code file(s) changed before HEAD ${head.slice(0, 7)} — re-cut a candidate, do not promote a stale one`,
    );
  }
}

// ---- 5. non-superseded ------------------------------------------------------
if (candidate.candidateLifecycle !== "frozen") {
  fail(`candidate lifecycle is "${candidate.candidateLifecycle}", not "frozen" — cannot promote`);
}
if (manifest.candidateLifecycle === "superseded" || String(manifest.supersededNote ?? "").trim()) {
  fail("the base manifest is marked superseded — reconcile it before promoting a candidate");
}

// ---- report -----------------------------------------------------------------
if (problems.length > 0) {
  console.error(`Cannot promote ${candidatePath}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// Derive the promoted verdicts from the candidate's recorded suites + any owner
// evidence — never authored. Production-owner suites (release-check) keep their
// frozen status unless owner evidence has been recorded; the historical suite
// results are never rewritten.
const promotedVerdicts = deriveVerdicts(
  { ...manifest, suites: candidate.suites, rcSha: candidate.rcSha, candidateLifecycle: "promoted" },
  gates,
  { manifestValid: true },
);

// A public-paid active verdict may not be proposed without owner production
// evidence — a non-production candidate alone can never carry paid.
if (isActiveVerdict(promotedVerdicts.public_paid) && !gates) {
  console.error(
    "Refusing to propose an active public-paid verdict with no owner evidence — " +
      "record a live transaction + release-check before promoting the paid tier.",
  );
  process.exit(1);
}

console.log(`Candidate ${String(candidate.rcSha).slice(0, 7)} is promotable. Derived verdicts:`);
console.log(`  code=${promotedVerdicts.automated_code_gate}, beta=${promotedVerdicts.capped_beta}, paid=${promotedVerdicts.public_paid}`);
console.log(`  auth journey observed: ${candidate.suites.some((s) => classifySuite(s) === "auth_journey" && isPassing(s.status))}`);

if (!flag("--write")) {
  console.log("\n(dry run — pass --write to emit a proposed manifest for review.)");
  process.exit(0);
}

// Build the PROPOSED manifest: adopt the candidate's suites + SHA + promoted
// lifecycle + derived verdicts. Written to a NEW file, never the tracked one.
const proposed = {
  ...manifest,
  rcSha: candidate.rcSha,
  candidateLifecycle: "promoted",
  suites: candidate.suites.map((s) => {
    const rest = { ...s };
    delete rest.suiteClass; // candidate-only annotation, not a manifest field
    return rest;
  }),
  verdicts: promotedVerdicts,
};
const outPath = opt("--out", `${manifestPath.replace(/\.json$/, "")}.promoted-${String(candidate.rcSha).slice(0, 7)}.json`);
if (existsSync(outPath) && !flag("--force")) {
  console.error(`Refusing to overwrite ${outPath} without --force.`);
  process.exit(1);
}
writeFileSync(outPath, JSON.stringify(proposed, null, 2) + "\n");
console.log(`\nProposed promoted manifest written to ${outPath}.`);
console.log("Review it, then adopt via a PR that replaces the tracked manifest and regenerates STATUS.md.");
