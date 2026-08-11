#!/usr/bin/env node
/**
 * Freeze a release candidate into an immutable, SHA-pinned artifact (MW-V17-02).
 *
 * The release-candidate workflow used to upload the UNCHANGED draft manifest as
 * "evidence" — nothing proved a workflow had frozen the exact candidate, and the
 * manifest's verdicts were hand-typed. This script produces the real thing: a
 * per-run candidate record keyed by the exact HEAD SHA, with suite provenance,
 * evidence hashes and verdicts DERIVED from the gates (see src/lib/release/
 * candidate.ts). It refuses to freeze a SHA that is not the checked-out HEAD, and
 * refuses to overwrite an existing candidate file with different content.
 *
 * It NEVER writes to main and needs no write permission: it emits one artifact
 * the workflow uploads. Promotion of that artifact into the tracked manifest is a
 * separate, reviewed step.
 *
 * Usage:
 *   node scripts/freeze-candidate.mjs [--sha <40hex>] [--run-id <id>]
 *        [--provenance workflow|local] [--mark-code-green] [--out <path>]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildCandidate, validateCandidateArtifact } from "./candidate-lib.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const git = (a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const HEAD = git(["rev-parse", "HEAD"]);
const rcSha = opt("--sha", HEAD);
if (!/^[0-9a-f]{40}$/.test(rcSha)) {
  console.error(`--sha must be a full 40-character commit SHA (got ${rcSha}).`);
  process.exit(2);
}
if (rcSha !== HEAD) {
  console.error(
    `Refusing to freeze ${rcSha.slice(0, 7)}: it is not the checked-out HEAD ` +
      `${HEAD.slice(0, 7)}. A candidate must freeze the exact commit.`,
  );
  process.exit(1);
}

const runId = opt("--run-id", process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`);
const runProvenance = opt("--provenance", process.env.GITHUB_RUN_ID ? "workflow" : "local");
const markCodeGreen = flag("--mark-code-green");

const MANIFEST_PATH = "docs/release/manifest.v16.json";
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

// The code gates the workflow runs before this step. When --mark-code-green is
// passed (i.e. those steps already succeeded in THIS run), record them as
// ci_pass at the frozen SHA; otherwise reflect the manifest's declared status.
const CODE_GATES = new Set([
  "lint",
  "typecheck",
  "unit-contract-safety",
  "eval-gate",
  "production-build",
  "e2e-public",
]);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const evidenceHashes = {};
const suites = manifest.suites.map((s) => {
  let status = s.status;
  let sha = null;
  let evidence = s.evidence;
  if (markCodeGreen && CODE_GATES.has(s.id)) {
    status = "ci_pass";
    sha = rcSha;
    evidence = evidence ?? `workflow-run:${runId}`;
  } else if (["local_pass", "ci_pass", "preview_pass", "live_rehearsed", "observed"].includes(status)) {
    sha = s.sha ?? rcSha;
  }
  const rec = { id: s.id, command: s.command, required: !!s.required, status, sha, counts: s.counts, evidence };
  if (evidence && existsSync(evidence)) {
    const h = sha256(readFileSync(evidence));
    evidenceHashes[evidence] = h;
    rec.artifactHash = h;
  }
  // Drop undefined keys for a stable artifact.
  if (rec.counts === undefined) delete rec.counts;
  if (rec.evidence === undefined) delete rec.evidence;
  return rec;
});

// The workflow validates the manifest (npm run release-manifest) BEFORE this
// step, so validity is known. Locally, --assume-valid records that the caller
// ran the validator; without it verdicts derive as UNASSESSED, which is the safe
// default (an unvalidated manifest can never certify a candidate).
const manifestValid = flag("--assume-valid") || process.env.GITHUB_RUN_ID != null;

const generatedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const rollbackTarget = (manifest.rollback.match(/\b([0-9a-f]{7,40})\b/) ?? [])[1] ?? "unknown";

const candidate = buildCandidate(manifest, {
  rcSha,
  runId,
  runProvenance,
  generatedAtUtc,
  environmentClass: "non_production",
  rollbackTarget,
  suites,
  evidenceHashes,
  manifestValid,
});

const violations = validateCandidateArtifact(candidate, manifest, {
  expectHeadSha: HEAD,
  manifestValid,
});
if (violations.length > 0) {
  console.error("Candidate is invalid — not writing:");
  for (const v of violations) console.error(`  [${v.rule}] ${v.message}`);
  process.exit(1);
}

const outDir = "docs/release/evidence/v17/candidate";
const outPath = opt("--out", `${outDir}/${rcSha}.json`);
mkdirSync(outDir, { recursive: true });

const serialized = JSON.stringify(candidate, null, 2) + "\n";
if (existsSync(outPath)) {
  const existing = readFileSync(outPath, "utf8");
  if (existing !== serialized) {
    console.error(
      `Refusing to overwrite ${outPath} with different content — a frozen ` +
        "candidate is immutable. Cut a new SHA instead.",
    );
    process.exit(1);
  }
}
writeFileSync(outPath, serialized);

console.log(`Froze candidate ${rcSha.slice(0, 7)} (${runProvenance}, run ${runId}).`);
console.log(
  `  verdicts: code=${candidate.verdicts.automated_code_gate}, ` +
    `beta=${candidate.verdicts.capped_beta}, paid=${candidate.verdicts.public_paid}`,
);
console.log(`  artifact: ${outPath}`);
