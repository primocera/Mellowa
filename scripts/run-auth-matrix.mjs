#!/usr/bin/env node
/**
 * Authenticated matrix release runner (MW-V12-02).
 *
 * WHAT to run is defined once, in e2e/support/matrix.ts, and kept in sync with
 * the specs and the seed script by tests/e2e-matrix-integrity.test.ts. This
 * script EXECUTES that matrix: it seeds each fixture the authenticated spec
 * needs, runs the authenticated specs across every viewport project, and
 * aggregates raw pass/fail/skip evidence pinned to the exact SHA.
 *
 * The gap it closes: `npm run test:e2e` exits 0 when every authenticated test
 * skips, and a single journeys.spec run necessarily skips the fixture-gated
 * journeys that need a different seed. So "green" told you nothing about whether
 * a required journey ever ran. This runner tracks each covered journey by title
 * across every seeded run and, in RC mode, BLOCKS if any of them never passed.
 *
 * Modes:
 *   --rc  (or RC_GATE=1): a missing environment, a zero-test run, a real
 *         failure, or a required journey that never passed all exit non-zero.
 *   default: if the environment is absent it prints NOT RUN, writes no
 *         evidence, and exits 0 so day-to-day use stays usable.
 *
 * Never seeds production: it sets E2E_REQUIRE_SEED_MARKER=1, so the seed script
 * refuses any database without the non-production marker table.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const RC = process.argv.includes("--rc") || process.env.RC_GATE === "1";

// Mirror playwright.config.ts: load .env.local so the runner sees the same
// E2E_* configuration the app and the seed script do.
function loadEnvLocal() {
  let contents;
  try {
    contents = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of contents.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (process.env[k] === undefined) process.env[k] = t.slice(eq + 1).trim();
  }
}
loadEnvLocal();

const configured =
  process.env.E2E_SUPABASE_TEST === "1" &&
  !!process.env.E2E_TEST_EMAIL &&
  !!process.env.E2E_TEST_PASSWORD;

if (!configured) {
  const msg =
    "authenticated matrix: seeded test environment absent " +
    "(E2E_SUPABASE_TEST, E2E_TEST_EMAIL, E2E_TEST_PASSWORD).";
  if (RC) {
    console.error(`BLOCKED (RC): ${msg} This did NOT run — it is not a pass.`);
    process.exit(1);
  }
  console.log(`NOT RUN: ${msg} No release evidence written.`);
  process.exit(0);
}

// Isolation: force the non-production marker check in the seed script.
process.env.E2E_REQUIRE_SEED_MARKER = "1";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

// The covered journeys' title needles come straight from the matrix file — only
// covered journeys carry a titleNeedle, so this is the authoritative list of
// journeys that MUST run. tests/e2e-matrix-integrity.test.ts ties each needle
// back to a real test title, so a rename cannot quietly drop one.
const matrixSrc = readFileSync(new URL("../e2e/support/matrix.ts", import.meta.url), "utf8");
const requiredNeedles = [...matrixSrc.matchAll(/titleNeedle:\s*"([^"]+)"/g)].map((m) => m[1]);

// The fixtures the authenticated spec must be seeded into, read from the spec's
// own skip guards (the authoritative statement of what each gated test needs),
// plus a base state for the ungated tests.
const authSpecSrc = readFileSync(new URL("../e2e/journeys.spec.ts", import.meta.url), "utf8");
const gated = [...authSpecSrc.matchAll(/SEEDED_STATE\s*!==\s*"([^"]+)"/g)].map((m) => m[1]);
const authSeedPlan = [...new Set(["plan-ready", ...gated])];

/** Run one playwright invocation and return flattened per-test records. */
function runSpec(spec, seededState) {
  const env = { ...process.env };
  if (seededState) env.E2E_SEED_STATE = seededState;
  let raw = "";
  try {
    raw = execFileSync("npx", ["playwright", "test", spec, "--reporter=json"], {
      encoding: "utf8",
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // Playwright exits non-zero on any test failure but still prints the JSON
    // report to stdout — parse it rather than losing the run.
    raw = err.stdout?.toString() ?? "";
    if (!raw) {
      console.error(`playwright produced no report for ${spec} (${seededState ?? "self-seeded"})`);
      return [];
    }
  }
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    console.error(`could not parse playwright JSON for ${spec}`);
    return [];
  }
  const records = [];
  const walk = (suite) => {
    for (const child of suite.suites ?? []) walk(child);
    for (const s of suite.specs ?? []) {
      for (const t of s.tests ?? []) {
        const status = t.results?.[t.results.length - 1]?.status ?? t.status ?? "unknown";
        records.push({ title: s.title, project: t.projectName ?? "?", status });
      }
    }
  };
  for (const s of report.suites ?? []) walk(s);
  return records;
}

const runs = [];
const allRecords = [];

// The daily-journey spec self-seeds each state in beforeEach, so it runs once.
console.log("running e2e/daily-journey.spec.ts (self-seeded matrix)…");
const daily = runSpec("e2e/daily-journey.spec.ts", undefined);
runs.push({ spec: "e2e/daily-journey.spec.ts", seededState: "per-test", count: daily.length });
allRecords.push(...daily);

// The authenticated spec is fixture-gated, so it runs once per required seed.
for (const state of authSeedPlan) {
  console.log(`seeding "${state}" and running e2e/journeys.spec.ts…`);
  try {
    execFileSync("node", ["scripts/seed-test-user.mjs", `--state=${state}`], {
      stdio: "pipe",
      env: process.env,
    });
  } catch (err) {
    console.error(`seed failed for ${state}: ${err.stdout?.toString() ?? err.message}`);
    if (RC) process.exit(1);
    continue;
  }
  const recs = runSpec("e2e/journeys.spec.ts", state);
  runs.push({ spec: "e2e/journeys.spec.ts", seededState: state, count: recs.length });
  allRecords.push(...recs);
}

const count = (s) => allRecords.filter((r) => r.status === s).length;
const passed = count("passed");
const skipped = count("skipped");
const failed = allRecords.filter((r) =>
  ["failed", "timedOut", "interrupted"].includes(r.status),
).length;
const total = allRecords.length;

// Which required journeys actually passed in at least one seeded run.
const neverPassed = requiredNeedles.filter(
  (needle) => !allRecords.some((r) => r.title.includes(needle) && r.status === "passed"),
);

const evidence = {
  sha,
  generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  mode: RC ? "rc" : "advisory",
  viewports: ["desktop", "mobile(375)", "mobile-320"],
  totals: { total, passed, failed, skipped },
  requiredJourneys: requiredNeedles.map((needle) => ({
    needle,
    passed: allRecords.some((r) => r.title.includes(needle) && r.status === "passed"),
  })),
  runs,
  records: allRecords,
};

const dir = "docs/release/evidence/v12/auth-matrix";
mkdirSync(dir, { recursive: true });
const out = `${dir}/${sha}.json`;
writeFileSync(out, JSON.stringify(evidence, null, 2));

console.log(
  `\nauth matrix @ ${sha.slice(0, 7)} — ${passed} passed / ${failed} failed / ` +
    `${skipped} skipped of ${total}. Evidence: ${out}`,
);
if (neverPassed.length) {
  console.log(`Required journeys that never passed:\n  - ${neverPassed.join("\n  - ")}`);
}

// ---- gate --------------------------------------------------------------
if (total === 0) {
  console.error("BLOCKED: zero authenticated tests executed.");
  process.exit(1);
}
if (failed > 0) {
  console.error(`FAILED: ${failed} authenticated test(s) failed.`);
  process.exit(1);
}
if (RC && neverPassed.length > 0) {
  console.error(
    `BLOCKED (RC): ${neverPassed.length} required journey(s) never passed — a ` +
      "required matrix row that did not run cannot certify a candidate.",
  );
  process.exit(1);
}
console.log(RC ? "RC gate: PASS." : "advisory run complete.");
