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
 * Honesty rule (MW-V18-02): a suite is only recorded as passing from the STEP
 * that actually executed it in THIS run. The blanket `--mark-code-green` flag is
 * gone — it marked all code gates green without proof any of them ran in this
 * run and, worse, tempted callers to lump the production-only `release-check`
 * into the same sweep. Instead the workflow emits a run summary
 * (`scripts/emit-rc-run-summary.mjs`) listing each suite that executed and its
 * result; freeze records passes ONLY from that summary. The authenticated
 * journey is verified against its own SHA-pinned evidence file (non-zero passed,
 * zero failed). A production-owner suite (release-check) is REFUSED here — a
 * non-production RC can never certify production.
 *
 * Usage:
 *   node scripts/freeze-candidate.mjs [--sha <40hex>] [--run-id <id>]
 *        [--provenance workflow|local] [--run-summary <path>] [--out <path>]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildCandidate,
  classifySuite,
  isPassing,
  validateCandidateArtifact,
} from "./candidate-lib.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const die = (msg, code = 1) => {
  console.error(msg);
  process.exit(code);
};

const git = (a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const HEAD = git(["rev-parse", "HEAD"]);
const rcSha = opt("--sha", HEAD);
if (!/^[0-9a-f]{40}$/.test(rcSha)) {
  die(`--sha must be a full 40-character commit SHA (got ${rcSha}).`, 2);
}
if (rcSha !== HEAD) {
  die(
    `Refusing to freeze ${rcSha.slice(0, 7)}: it is not the checked-out HEAD ` +
      `${HEAD.slice(0, 7)}. A candidate must freeze the exact commit.`,
  );
}

const runId = opt("--run-id", process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`);
const runProvenance = opt("--provenance", process.env.GITHUB_RUN_ID ? "workflow" : "local");
// Workflow runs record CI passes; a local run can only record local passes.
const passStatus = runProvenance === "workflow" ? "ci_pass" : "local_pass";

const MANIFEST_PATH = "docs/release/manifest.v16.json";
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// ---- run summary: the only source of "this suite passed in THIS run" --------
// Shape: { sha, runId?, environmentClass?, suites: [{ id, result:"pass"|"fail",
//          command?, counts?, evidence? }] }. A suite absent from the summary
// keeps its manifest status (typically blocked/not_run) — never guessed green.
const summaryPath = opt("--run-summary");
let summaryById = new Map();
if (summaryPath) {
  if (!existsSync(summaryPath)) {
    die(`--run-summary ${summaryPath} does not exist — a run summary is required to record passes.`);
  }
  let summary;
  try {
    summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  } catch (err) {
    die(`--run-summary ${summaryPath} is not valid JSON: ${err.message}`);
  }
  if (summary.sha && summary.sha !== rcSha) {
    die(
      `run summary is for ${String(summary.sha).slice(0, 7)} but the candidate is ` +
        `${rcSha.slice(0, 7)} — a run summary can only record the run it belongs to.`,
    );
  }
  for (const entry of summary.suites ?? []) {
    if (entry && entry.id) summaryById.set(entry.id, entry);
  }
}

const evidenceHashes = {};

/** Read + hash an evidence file, recording its hash in the shared map. */
function hashEvidence(path, rec) {
  if (path && existsSync(path)) {
    const h = sha256(readFileSync(path));
    evidenceHashes[path] = h;
    rec.artifactHash = h;
  }
}

const suites = manifest.suites.map((s) => {
  const cls = classifySuite(s);
  const rec = {
    id: s.id,
    command: s.command,
    required: !!s.required,
    status: s.status,
    sha: null,
    counts: s.counts,
    evidence: s.evidence,
    suiteClass: cls,
  };

  const summaryEntry = summaryById.get(s.id);

  // Carry forward an already-passing manifest status (e.g. owner evidence) at
  // its pinned SHA. This is not a fresh pass; it is the recorded historical one.
  if (isPassing(s.status)) {
    rec.sha = s.sha ?? rcSha;
  }

  if (summaryEntry && summaryEntry.result === "pass") {
    if (cls === "production_owner") {
      // Fail closed: the RC is non-production, so it must never mark a
      // production-only suite green. release-check is owner/production evidence.
      die(
        `Refusing to record production-owner suite "${s.id}" as passing from a ` +
          `${runProvenance} run — release-check requires the real production ` +
          "environment and is recorded only at promotion, never at freeze.",
      );
    }
    if (cls === "auth_journey") {
      // The authenticated matrix must be verified against its own SHA-pinned
      // evidence: it exists, it ran at THIS commit, and it discovered a non-zero
      // number of tests that all passed. A bare "pass" flag is not enough.
      const evPath = summaryEntry.evidence;
      if (!evPath || !existsSync(evPath)) {
        die(
          `Auth journey "${s.id}" is marked pass but its evidence file ` +
            `${evPath ?? "(none)"} is missing — cannot certify an unproven matrix run.`,
        );
      }
      let ev;
      try {
        ev = JSON.parse(readFileSync(evPath, "utf8"));
      } catch (err) {
        die(`Auth evidence ${evPath} is not valid JSON: ${err.message}`);
      }
      if (ev.sha !== rcSha) {
        die(
          `Auth evidence ${evPath} was produced at ${String(ev.sha).slice(0, 7)}, ` +
            `not the candidate ${rcSha.slice(0, 7)} — superseded evidence never carries forward.`,
        );
      }
      const t = ev.totals ?? {};
      if (!(t.total > 0) || !(t.passed > 0) || (t.failed ?? 0) !== 0) {
        die(
          `Auth evidence ${evPath} does not prove a clean non-zero run ` +
            `(total=${t.total}, passed=${t.passed}, failed=${t.failed}) — a zero-test ` +
            "or failing matrix cannot certify a candidate.",
        );
      }
      rec.status = passStatus;
      rec.sha = rcSha;
      rec.counts = { total: t.total, passed: t.passed, failed: t.failed ?? 0, skipped: t.skipped ?? 0 };
      rec.evidence = evPath;
      hashEvidence(evPath, rec);
    } else {
      // code gate
      rec.status = passStatus;
      rec.sha = rcSha;
      rec.evidence = summaryEntry.evidence ?? s.evidence ?? `workflow-run:${runId}`;
      if (summaryEntry.counts) rec.counts = summaryEntry.counts;
      hashEvidence(rec.evidence, rec);
    }
  } else if (summaryEntry && summaryEntry.result === "fail") {
    rec.status = "failed";
    rec.sha = null;
    if (summaryEntry.counts) rec.counts = summaryEntry.counts;
  } else if (isPassing(s.status) && s.evidence) {
    // Carried-forward pass: hash its existing evidence too.
    hashEvidence(s.evidence, rec);
  }

  // Drop undefined/null keys for a stable artifact.
  if (rec.counts === undefined) delete rec.counts;
  if (rec.evidence === undefined) delete rec.evidence;
  if (rec.sha === null) delete rec.sha;
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
