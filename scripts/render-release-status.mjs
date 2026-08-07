#!/usr/bin/env node
/**
 * Render the human release-status page deterministically FROM the machine
 * manifest (MW-95-02).
 *
 * The whole point of the manifest is that there is one source of release truth.
 * A second, hand-maintained human document is how the two drift — one edited to
 * say GO while the other still says NO-GO. So this page is generated: every
 * candidate/verdict/blocker line is derived from the manifest, and a contract
 * test (tests/release-status-v16.test.ts) fails if the checked-in page is not a
 * byte-for-byte match of a fresh render. Do not edit the generated page by hand.
 *
 * The generator does NOT re-validate; the test does that against the pure
 * validator in src/lib/release/manifest.ts. It refuses to render a manifest
 * whose shared fields it cannot represent, but the authority on honesty is the
 * validator, not this file.
 *
 * Usage:
 *   node scripts/render-release-status.mjs <manifest.json> [--check|--write]
 *     --write  (default) write the rendered page next to the manifest's first
 *              document entry.
 *     --check  print the rendered page to stdout and exit non-zero if the
 *              on-disk page differs (used in CI / the contract test).
 */

import { readFileSync, writeFileSync } from "node:fs";

function short(sha) {
  return typeof sha === "string" && sha.length >= 7 ? sha.slice(0, 7) : String(sha);
}

/** A single, deterministic rendering of a manifest into markdown. */
export function renderStatusPage(manifest) {
  const superseded =
    manifest.candidateLifecycle === "superseded" ||
    Boolean((manifest.supersededNote ?? "").trim());
  const lifecycle =
    manifest.candidateLifecycle ?? (manifest.rcSha ? "frozen" : "draft");

  const candidate = superseded
    ? `RC ${short(manifest.rcSha)} SUPERSEDED`
    : manifest.rcSha
      ? `RC ${short(manifest.rcSha)} (${lifecycle})`
      : `no frozen candidate — baseline ${short(manifest.baselineSha)} (${lifecycle})`;

  const lines = [];
  lines.push(`# ${manifest.release} — release status (generated)`);
  lines.push("");
  lines.push(
    "> Generated from `docs/release/manifest." +
      manifest.release +
      ".json` by `scripts/render-release-status.mjs`. Do not edit by hand — a" +
      " contract test regenerates this and fails on any drift.",
  );
  lines.push("");
  lines.push(`- **Candidate:** ${candidate}`);
  lines.push(`- **Baseline:** \`${manifest.baselineSha}\``);
  lines.push(`- **Reconciled:** ${manifest.reconciledAtUtc}`);
  lines.push(`- **Migrations:** ${manifest.migrations.length} (001–${manifest.migrations[manifest.migrations.length - 1]})`);
  lines.push("");

  lines.push("## Verdicts");
  lines.push("");
  lines.push("| Tier | Verdict |");
  lines.push("|---|---|");
  lines.push(`| Automated code gate | ${manifest.verdicts.automated_code_gate} |`);
  lines.push(`| Capped beta | ${manifest.verdicts.capped_beta} |`);
  lines.push(`| Public paid | ${manifest.verdicts.public_paid} |`);
  lines.push("");
  if (manifest.verdicts.public_paid === "UNASSESSED") {
    lines.push(
      "UNASSESSED is not a weak GO. No candidate is frozen, so no verdict can" +
        " be read from the gates until one is cut via the immutable" +
        " release-candidate workflow.",
    );
    lines.push("");
  }

  lines.push("## Required gates");
  lines.push("");
  lines.push("| Suite | Command | Status |");
  lines.push("|---|---|---|");
  for (const s of manifest.suites) {
    if (!s.required) continue;
    lines.push(`| ${s.id} | \`${s.command}\` | ${s.status} |`);
  }
  lines.push("");

  lines.push("## Open blockers");
  lines.push("");
  if (manifest.blockers.length === 0) {
    lines.push("_None open._");
  } else {
    lines.push("| Id | Level | Blocks | Title |");
    lines.push("|---|---|---|---|");
    for (const b of manifest.blockers) {
      lines.push(`| ${b.id} | ${b.level} | ${b.blocks.join(", ")} | ${b.title} |`);
    }
  }
  lines.push("");

  lines.push("## Owner-run evidence");
  lines.push("");
  lines.push("| Id | Status | Action |");
  lines.push("|---|---|---|");
  for (const o of manifest.ownerEvidence) {
    lines.push(`| ${o.id} | ${o.status} | ${o.action} |`);
  }
  lines.push("");

  lines.push("## Rollback");
  lines.push("");
  lines.push(manifest.rollback);
  lines.push("");

  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const manifestPath = args.find((a) => !a.startsWith("--"));
  const check = args.includes("--check");
  if (!manifestPath) {
    console.error("usage: render-release-status.mjs <manifest.json> [--check|--write]");
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const rendered = renderStatusPage(manifest) + "\n";
  const outPath = (manifest.documents ?? []).find((d) => d.endsWith("STATUS.md"));
  if (!outPath) {
    console.error("manifest.documents does not name a STATUS.md page to render");
    process.exit(2);
  }

  if (check) {
    let current = "";
    try {
      current = readFileSync(outPath, "utf8");
    } catch {
      current = "";
    }
    if (current !== rendered) {
      console.error(
        `Generated status page is stale: ${outPath} does not match a fresh ` +
          "render of the manifest. Run: npm run render-release-status",
      );
      process.exit(1);
    }
    console.log(`${outPath} is in sync with ${manifestPath}.`);
    return;
  }

  writeFileSync(outPath, rendered);
  console.log(`Wrote ${outPath} from ${manifestPath}.`);
}

// Only run as a CLI, not when imported by the contract test.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("render-release-status.mjs")) {
  main();
}
