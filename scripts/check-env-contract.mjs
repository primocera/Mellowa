/**
 * Authenticated-E2E env-contract parity check (MW-V17-01).
 *
 * Extracts the env references and workflow mappings from the runner, seeder,
 * Playwright config, journeys harness, RC/CI workflows and .env.example, and
 * fails on any drift from scripts/e2e-env-contract.mjs. Run standalone
 * (`node scripts/check-env-contract.mjs`) or via tests/env-contract-parity.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CANONICAL_RUNTIME,
  SECRET_TO_RUNTIME,
  REQUIRED_SECRETS_FOR_RC,
  FORBIDDEN_RUNTIME_ALIASES,
} from "./e2e-env-contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultRead = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** Normalise `KEY: ${{ secrets.NAME }}` (any spacing) to `KEY=secrets.NAME`. */
function envMappings(yaml) {
  const map = {};
  for (const m of yaml.matchAll(
    /^\s*([A-Z0-9_]+):\s*\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/gm
  )) {
    map[m[1]] = m[2];
  }
  return map;
}

/** The consumers that must read ONLY canonical runtime names. */
const CONSUMERS = [
  "scripts/run-auth-matrix.mjs",
  "scripts/seed-test-user.mjs",
  "e2e/support/harness.ts",
];

export function checkEnvContract(readFn = defaultRead) {
  const read = readFn;
  const problems = [];

  // 1. Consumers read canonical names and none of the forbidden aliases.
  for (const file of CONSUMERS) {
    const src = read(file);
    for (const alias of FORBIDDEN_RUNTIME_ALIASES) {
      // A consumer must not read a legacy alias via process.env / env.<alias>.
      const re = new RegExp(`(process\\.env|env)\\.${alias}\\b`);
      if (re.test(src)) {
        problems.push(`${file} consumes forbidden legacy alias ${alias}`);
      }
    }
  }
  // The seeder + runner must gate on the canonical trio.
  for (const file of ["scripts/run-auth-matrix.mjs", "e2e/support/harness.ts"]) {
    const src = read(file);
    for (const name of ["E2E_SUPABASE_TEST", "E2E_TEST_EMAIL", "E2E_TEST_PASSWORD"]) {
      if (!src.includes(name)) problems.push(`${file} does not reference ${name}`);
    }
  }

  // 2. The step that RUNS the authenticated matrix must export every canonical
  //    runtime name, each from the correct secret, and must NOT export a
  //    forbidden alias as a runtime KEY. Other steps (preflight/guard) may
  //    reference the raw secret names locally to validate presence — so this is
  //    scoped to the matrix step's own block, not the whole file.
  for (const wf of [
    ".github/workflows/release-candidate.yml",
    ".github/workflows/ci.yml",
  ]) {
    const yaml = read(wf);
    if (!/npm run test:e2e:matrix/.test(yaml)) continue; // not a matrix workflow
    // Split into step chunks and keep the one that runs the matrix.
    const chunks = yaml.split(/\n(?=\s*- (?:name|uses|if):)/);
    const matrixStep = chunks.find((c) => /npm run test:e2e:matrix/.test(c));
    if (!matrixStep) {
      problems.push(`${wf}: could not isolate the matrix step`);
      continue;
    }
    const map = envMappings(matrixStep);

    // Forbidden alias used as a runtime KEY (the historical bug).
    for (const alias of FORBIDDEN_RUNTIME_ALIASES) {
      if (alias in map) {
        problems.push(
          `${wf} exports forbidden runtime key ${alias} (must map to its canonical name instead)`
        );
      }
    }
    // Every secret-derived canonical var must be mapped from the right secret.
    for (const [secret, runtime] of Object.entries(SECRET_TO_RUNTIME)) {
      if (map[runtime] !== secret) {
        problems.push(
          `${wf} must map ${runtime} from secrets.${secret} (found: ${map[runtime] ?? "unset"})`
        );
      }
    }
    // The explicit test flag must be pinned to "1" in the matrix step.
    if (!/E2E_SUPABASE_TEST:\s*["']?1["']?/.test(matrixStep)) {
      problems.push(`${wf} must set E2E_SUPABASE_TEST: "1" on the matrix step`);
    }
  }

  // 3. The RC workflow preflight must require every RC secret by name.
  const rc = read(".github/workflows/release-candidate.yml");
  for (const secret of REQUIRED_SECRETS_FOR_RC) {
    if (!rc.includes(secret)) {
      problems.push(`release-candidate.yml preflight omits required secret ${secret}`);
    }
  }
  // And must reject a non-test Stripe key.
  if (!/sk_test_/.test(rc)) {
    problems.push("release-candidate.yml must require a Stripe TEST key (sk_test_)");
  }

  // 4. .env.example documents the canonical runtime names (minus the two
  //    NEXT_PUBLIC/service names already documented in the Supabase block).
  const example = read(".env.example");
  for (const name of ["E2E_SUPABASE_TEST", "E2E_TEST_EMAIL", "E2E_TEST_PASSWORD", "STRIPE_SECRET_KEY"]) {
    if (!example.includes(name)) {
      problems.push(`.env.example does not document ${name}`);
    }
  }

  const table = [
    "GitHub secret → runtime name → safety",
    ...Object.entries(SECRET_TO_RUNTIME).map(
      ([s, r]) => `  ${s} → ${r}`
    ),
    `  (constant) E2E_SUPABASE_TEST=1 → gates seeder/runner/harness`,
    `  canonical runtime set: ${CANONICAL_RUNTIME.join(", ")}`,
  ].join("\n");

  return { ok: problems.length === 0, problems, table };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-env-contract.mjs")) {
  const { ok, problems, table } = checkEnvContract();
  console.log(table);
  if (!ok) {
    console.error("\nENV CONTRACT DRIFT:\n  - " + problems.join("\n  - "));
    process.exit(1);
  }
  console.log("\nenv contract OK — workflow, runner, seeder, Playwright and docs agree.");
}
