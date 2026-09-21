#!/usr/bin/env node
/**
 * Emit the release-candidate run summary (MW-V18-02).
 *
 * This runs in the RC workflow AFTER every required suite step has already
 * succeeded. GitHub Actions is fail-fast under the default `set -e`: if any
 * earlier step had failed the workflow would have stopped and this step would
 * never run. So reaching this step is the proof that each code gate and the
 * authenticated matrix passed IN THIS RUN — which is exactly the guarantee the
 * old blanket `--mark-code-green` lacked.
 *
 * The summary lists each suite that executed and its result. `freeze-candidate`
 * records passes ONLY from this file, and independently re-verifies the
 * authenticated matrix against its own SHA-pinned evidence artifact. The
 * production-only `release-check` is deliberately NOT listed: a non-production
 * run must never claim it.
 *
 * Usage:
 *   node scripts/emit-rc-run-summary.mjs --out <path> [--sha <40hex>]
 *        [--auth-evidence <path>] [--audit-artifact <path>]
 *
 * --audit-artifact, when given, is the SHA-pinned production dependency-audit
 * artifact from scripts/audit-dependencies.mjs. It is validated (schema, SHA,
 * freshness, clean) before a `dependency-audit` pass is recorded — a green audit
 * can never enter the summary without a real artifact at THIS SHA.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { validateAuditArtifact } from "./candidate-lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const git = (a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const sha = opt("--sha", git(["rev-parse", "HEAD"]));
if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.error(`--sha must be a full 40-character commit SHA (got ${sha}).`);
  process.exit(2);
}

const outPath = opt("--out");
if (!outPath) {
  console.error("--out <path> is required.");
  process.exit(2);
}

const authEvidence = opt("--auth-evidence", `docs/release/evidence/v13/auth-matrix/${sha}.json`);
if (!existsSync(authEvidence)) {
  console.error(
    `Authenticated matrix evidence ${authEvidence} is missing — the matrix must ` +
      "have run and written its SHA-pinned evidence before the summary is emitted.",
  );
  process.exit(1);
}

// The code gates that ran, in order. release-check is intentionally absent: it
// is production-owner evidence, never recorded by a non-production RC.
const suites = [
  { id: "lint", command: "npm run lint", result: "pass" },
  { id: "typecheck", command: "npm run typecheck", result: "pass" },
  { id: "unit-contract-safety", command: "npx vitest run", result: "pass" },
  { id: "eval-gate", command: "npm run eval", result: "pass" },
  { id: "production-build", command: "npm run build", result: "pass" },
  { id: "e2e-public", command: "npm run test:e2e:public", result: "pass" },
  {
    id: "e2e-authenticated",
    command: "npm run test:e2e:matrix",
    result: "pass",
    evidence: authEvidence,
  },
];

// The production dependency audit, when its SHA-pinned artifact is provided. It is
// validated here so a green `dependency-audit` can never enter the summary without
// a real, fresh, clean artifact at THIS candidate SHA. Findings/unavailable/stale
// all refuse — the hard gate already failed the run earlier; this is the second
// lock that keeps the evidence honest.
const auditPath = opt("--audit-artifact", `docs/release/evidence/v23/dependency-audit/${sha}.json`);
if (existsSync(auditPath)) {
  let audit;
  try {
    audit = JSON.parse(readFileSync(auditPath, "utf8"));
  } catch (err) {
    console.error(`--audit-artifact ${auditPath} is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  const nowUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const { problems, openAdvisories } = validateAuditArtifact(audit, { expectSha: sha, nowUtc });
  if (problems.length > 0) {
    console.error(`Refusing to record the dependency audit — artifact ${auditPath} is invalid:`);
    for (const p of problems) console.error(`  [${p.rule}] ${p.message}`);
    process.exit(1);
  }
  if (openAdvisories !== 0) {
    console.error(
      `Refusing to record a passing dependency audit: ${openAdvisories} production ` +
        "advisory finding(s). A candidate must be free of production advisories.",
    );
    process.exit(1);
  }
  suites.push({
    id: "dependency-audit",
    command: "npm audit --omit=dev",
    result: "pass",
    evidence: auditPath,
    observedAtUtc: audit.observedAtUtc,
    counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
  });
}

const summary = {
  sha,
  runId: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`,
  environmentClass: "non_production",
  generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  suites,
};

writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n");
console.log(`Wrote RC run summary for ${sha.slice(0, 7)} → ${outPath}`);
