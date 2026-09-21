#!/usr/bin/env node
/**
 * Production dependency-audit gate + SHA-pinned artifact (v23, WS-B).
 *
 * The old release line let `openDependencyAdvisories: 0` be hand-typed into owner
 * evidence and carried forward indefinitely, so a new advisory disclosed after a
 * freeze stayed invisible and the verdict stayed GO. This script makes the
 * production dependency posture a FRESH, machine-observed, SHA-pinned fact:
 *
 *  1. runs `npm audit --omit=dev --json` (production dependencies only),
 *  2. writes an immutable artifact keyed by the exact candidate SHA, recording the
 *     command, the UTC instant, the per-severity counts and a status, and
 *  3. exits NON-ZERO on any production finding OR when the audit is unavailable
 *     (registry unreachable / invalid JSON). An unavailable audit is NEVER
 *     converted to "0 advisories" — it blocks, so the RC workflow fails closed.
 *
 * It records NO secret, package name payload or advisory body — only counts and
 * provenance. `scripts/candidate-lib.mjs#validateAuditArtifact` re-checks the
 * artifact (schema, SHA, freshness, internal consistency) wherever it is consumed.
 *
 * Usage:
 *   node scripts/audit-dependencies.mjs [--sha <40hex>] [--out <path>]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const git = (a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const sha = opt("--sha", process.env.GITHUB_SHA ?? git(["rev-parse", "HEAD"]));
if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.error(`--sha must be a full 40-character commit SHA (got ${sha}).`);
  process.exit(2);
}

const command = "npm audit --omit=dev --json";
const observedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const outPath = opt("--out", `docs/release/evidence/v23/dependency-audit/${sha}.json`);

const SEVERITIES = ["info", "low", "moderate", "high", "critical"];
const zeroCounts = () => ({ info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 });

/**
 * Run the audit, tolerating npm's non-zero exit when it finds vulnerabilities.
 * The command is a single, static, trusted string (no interpolation), so shell
 * execution carries no injection surface and avoids Node's args+shell warning.
 */
const res = spawnSync("npm audit --omit=dev --json", {
  encoding: "utf8",
  shell: true,
  maxBuffer: 32 * 1024 * 1024,
});

let status = "clean";
let reason;
let counts = zeroCounts();

let parsed = null;
if (res.stdout) {
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    parsed = null;
  }
}

if (!parsed || typeof parsed !== "object" || !parsed.metadata?.vulnerabilities) {
  // No parseable audit result — registry unreachable, offline, or an npm error.
  // This is UNAVAILABLE, never 0. It must block certification.
  status = "unavailable";
  reason =
    res.error?.code === "ENOENT"
      ? "npm not found on PATH"
      : `npm audit produced no parseable JSON (exit ${res.status ?? "unknown"})`;
} else {
  const v = parsed.metadata.vulnerabilities;
  for (const k of SEVERITIES) counts[k] = Number.isInteger(v[k]) ? v[k] : 0;
  counts.total = Number.isInteger(v.total)
    ? v.total
    : SEVERITIES.reduce((a, k) => a + counts[k], 0);
  status = counts.total > 0 ? "findings" : "clean";
}

const artifact = {
  schema: 1,
  application: "mellowa",
  candidateSha: sha,
  command,
  observedAtUtc,
  status,
  ...(reason ? { reason } : {}),
  counts,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");

const summary =
  status === "unavailable"
    ? `UNAVAILABLE (${reason})`
    : `${counts.total} production advisory finding(s) [critical ${counts.critical}, high ${counts.high}, moderate ${counts.moderate}, low ${counts.low}]`;
console.log(`Dependency audit @ ${sha.slice(0, 7)}: ${status} — ${summary}`);
console.log(`  artifact: ${outPath}`);

// Fail closed: any production finding OR an unavailable audit blocks the gate.
if (status !== "clean") {
  console.error(
    status === "unavailable"
      ? "::error title=Dependency audit unavailable::the production audit could not be completed; it blocks certification and is never treated as 0 advisories."
      : `::error title=Production dependency advisories::npm audit --omit=dev found ${counts.total} finding(s); a release candidate must be free of production advisories.`,
  );
  process.exit(1);
}
