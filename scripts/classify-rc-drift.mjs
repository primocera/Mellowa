#!/usr/bin/env node
/**
 * Classify the file drift between a frozen release candidate and current HEAD
 * (MW-V12-01).
 *
 * Why this exists: manifest.v11.json pins RC 0025a502, but product code changed
 * after the freeze. A superseded candidate must not present an active verdict,
 * and the decision of whether the drift is "documentation only" (harmless to
 * the candidate) or "product code changed" (invalidates it) must be
 * reproducible and machine-readable rather than argued in prose.
 *
 * This script diffs `<rcSha>..<toSha>` with git and classifies every changed
 * path as `documentation` or `product_code`. If any product-code file changed,
 * the candidate is `product_code_changed` — its evidence no longer certifies
 * HEAD. Only when every change is documentation is the drift
 * `documentation_only`, which the release-manifest validator treats as safe.
 *
 * Usage:
 *   node scripts/classify-rc-drift.mjs                    # rcSha from manifest, toSha = HEAD
 *   node scripts/classify-rc-drift.mjs <rcSha> <toSha>    # explicit range
 *   node scripts/classify-rc-drift.mjs --json             # print only the JSON block
 *
 * Deterministic and read-only: it runs `git diff --name-status` and never
 * touches the working tree.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MANIFEST_PATH = "docs/release/manifest.v11.json";

/**
 * A changed path is product code if it can alter what the app does or how it is
 * tested/built. Documentation is prose and recorded evidence only. Unknown
 * shapes fail safe: they count as product code, because an unclassified change
 * invalidating a candidate is the safe error, and a doc-only pass letting stale
 * evidence stand is not.
 */
const PRODUCT_CODE_PREFIXES = [
  "src/",
  "app/",
  "e2e/",
  "scripts/",
  "tests/",
  "supabase/",
  "public/",
  "styles/",
];

const PRODUCT_CODE_FILES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "vitest.config.ts",
  "playwright.config.ts",
  "next.config.ts",
  "next.config.mjs",
  "tsconfig.json",
  "eslint.config.mjs",
  "postcss.config.mjs",
  "vercel.json",
  "middleware.ts",
]);

/** Prose and recorded evidence. Never invalidates a candidate on its own. */
function isDocumentation(path) {
  if (path.startsWith("docs/")) return true;
  // Root-level markdown notes (README, run logs, handoffs) are documentation.
  if (!path.includes("/") && path.toLowerCase().endsWith(".md")) return true;
  return false;
}

function classifyPath(path) {
  if (isDocumentation(path)) return "documentation";
  if (PRODUCT_CODE_FILES.has(path)) return "product_code";
  if (PRODUCT_CODE_PREFIXES.some((p) => path.startsWith(p))) return "product_code";
  // Fail safe: an unrecognised path is treated as product code so it cannot
  // silently be waved through as "docs only".
  return "product_code";
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--json");
  const jsonOnly = process.argv.includes("--json");

  let rcSha = args[0];
  const toSha = (args[1] ?? "HEAD").trim();

  if (!rcSha) {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    rcSha = manifest.rcSha;
    if (!rcSha) {
      console.error("No rcSha in the manifest and none passed on the command line.");
      process.exit(2);
    }
  }

  const fromSha = git(["rev-parse", rcSha]).trim();
  const headSha = git(["rev-parse", toSha]).trim();

  const raw = git(["diff", "--name-status", "-M", fromSha, headSha]).trim();
  const rows = raw ? raw.split("\n") : [];

  const files = [];
  for (const line of rows) {
    const parts = line.split("\t");
    const statusCode = parts[0];
    // For renames (R###) git prints old\tnew; classify by the new path.
    const path = parts[parts.length - 1];
    files.push({ path, status: statusCode[0], kind: classifyPath(path) });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  const productCode = files.filter((f) => f.kind === "product_code");
  const documentation = files.filter((f) => f.kind === "documentation");

  const classification =
    productCode.length > 0 ? "product_code_changed" : "documentation_only";

  const result = {
    fromRcSha: fromSha,
    toSha: headSha,
    generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    classification,
    totals: {
      changed: files.length,
      productCode: productCode.length,
      documentation: documentation.length,
    },
    productCodeFiles: productCode.map((f) => `${f.status} ${f.path}`),
    documentationFiles: documentation.map((f) => `${f.status} ${f.path}`),
  };

  if (jsonOnly) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `RC drift: ${fromSha.slice(0, 7)} -> ${headSha.slice(0, 7)} — ` +
      `${result.classification} ` +
      `(${result.totals.productCode} product-code, ` +
      `${result.totals.documentation} documentation of ${result.totals.changed} changed)\n`,
  );
  if (classification === "product_code_changed") {
    console.log(
      "The candidate is SUPERSEDED: product code changed after the freeze, so " +
        "its evidence no longer certifies HEAD. Product-code files:\n",
    );
    for (const f of productCode) console.log(`  ${f.status}  ${f.path}`);
  } else {
    console.log("Only documentation changed — the candidate is not invalidated.");
  }
  console.log("\n--- machine-readable ---\n");
  console.log(JSON.stringify(result, null, 2));
}

main();
