/**
 * Centralised fail-closed non-production guard (MW-V18-03).
 *
 * WHY THIS REPLACES THE SUBSTRING CHECK
 * -------------------------------------
 * The old guard decided an environment was "not production" by looking for the
 * substrings `prod`/`production` in the Supabase URL. That is unsound in both
 * directions: a production project whose ref is an opaque 20-char slug (the
 * normal case — refs carry no readable name) has no "prod" in it and would have
 * sailed through, while a disposable project someone named "prod-sandbox" would
 * have been refused. Absence of a scary word is not proof of safety.
 *
 * This guard instead verifies PROJECT IDENTITY explicitly:
 *   1. Parse the Supabase project ref from the canonical URL's hostname. A ref
 *      is the sub-domain label of a *.supabase.co / *.supabase.in host. Custom
 *      or malformed hosts are rejected unless explicitly allowlisted.
 *   2. Require an approved disposable ref (E2E_SUPABASE_PROJECT_REF) AND a
 *      non-empty allowlist (E2E_SUPABASE_ALLOWED_REFS). Require the known
 *      production ref (PRODUCTION_SUPABASE_PROJECT_REF) and FAIL if the target
 *      equals it. Safety is proven by identity, never inferred from a name.
 *   3. Confirm the anon and service-role credentials belong to that same
 *      approved project using the safest NON-SECRET signal available: the `ref`
 *      and `role` claims inside the Supabase JWT payload (base64url, not the
 *      signature). We decode only those two claims and never the whole payload.
 *   4. Require a Stripe TEST key (sk_test_/rk_test_), refuse a live key, and
 *      refuse any live-mode id (`*_live_*`) leaking into fixture env.
 *
 * The seeded-environment marker table stays as a SECOND defence (see
 * evaluateSeedMarker + the seeder), never the primary proof.
 *
 * OUTPUT DISCIPLINE: this module prints only variable NAMES, the opaque project
 * ref (which lives in the public URL anyway), the Stripe MODE, and problem
 * descriptions built from those. It never prints a key value, a JWT signature,
 * or a decoded JWT payload.
 *
 * It is dependency-free at import time (Node builtins only) so the RC workflow
 * can run it BEFORE `npm ci`. The optional live Stripe account probe is loaded
 * dynamically and only when explicitly requested.
 */

import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

export class GuardError extends Error {}

const SUPABASE_HOST_SUFFIXES = [".supabase.co", ".supabase.in"];
/** Supabase project refs are 20 lowercase alphanumeric characters. */
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;

/** Split a comma/space separated env list into trimmed, non-empty entries. */
export function splitList(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse the Supabase project ref from the canonical URL's hostname.
 * Throws GuardError (with a name/host-only message) on anything ambiguous.
 *
 * @param {string | undefined} rawUrl
 * @param {{ allowedHosts?: string[] }} [opts]
 * @returns {{ ref: string, host: string, kind: string }}
 */
export function parseSupabaseProjectRef(rawUrl, { allowedHosts = [] } = {}) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new GuardError("NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new GuardError("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
  }
  const host = u.hostname.toLowerCase();
  const suffix = SUPABASE_HOST_SUFFIXES.find((s) => host.endsWith(s));
  if (suffix) {
    if (u.protocol !== "https:") {
      throw new GuardError(
        "NEXT_PUBLIC_SUPABASE_URL must use https for a Supabase-hosted project"
      );
    }
    const label = host.slice(0, -suffix.length);
    if (!PROJECT_REF_RE.test(label)) {
      throw new GuardError(
        "NEXT_PUBLIC_SUPABASE_URL has a malformed Supabase project ref in its host"
      );
    }
    return { ref: label, host, kind: "supabase" };
  }
  const allow = allowedHosts.map((h) => h.toLowerCase());
  if (allow.includes(host)) {
    // A self-hosted/allowlisted host has no embedded ref; identify it by host.
    return { ref: `host:${host}`, host, kind: "custom" };
  }
  throw new GuardError(
    "NEXT_PUBLIC_SUPABASE_URL host is not a recognised Supabase host and is not in E2E_SUPABASE_ALLOWED_HOSTS"
  );
}

/**
 * Decode ONLY the `ref` and `role` claims from a Supabase JWT key. Returns null
 * if the value is not a decodable 3-part JWT. Never returns (or exposes) the raw
 * payload or signature — this is the safe, non-secret identity signal.
 */
export function decodeSupabaseKeyClaims(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return {
      ref: typeof json.ref === "string" ? json.ref : null,
      role: typeof json.role === "string" ? json.role : null,
    };
  } catch {
    return null;
  }
}

/** Classify a Stripe secret key by mode without ever echoing it. */
export function evaluateStripeKey(key) {
  if (!key || typeof key !== "string") {
    return { ok: false, mode: null, problems: ["STRIPE_SECRET_KEY is not set"] };
  }
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) {
    return { ok: false, mode: "live", problems: ["STRIPE_SECRET_KEY is a LIVE key"] };
  }
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) {
    return { ok: true, mode: "test", problems: [] };
  }
  return {
    ok: false,
    mode: null,
    problems: ["STRIPE_SECRET_KEY is not a recognised Stripe TEST key (sk_test_…)"],
  };
}

/** Names of any env values that look like live-mode Stripe ids in fixtures. */
export function findLiveStripeIds(values) {
  const live = [];
  for (const [name, v] of Object.entries(values ?? {})) {
    if (typeof v === "string" && /_live_/.test(v)) live.push(name);
  }
  return live;
}

function checkCredential(name, claims, expectRole, ref, isCustomHost, problems) {
  if (!claims) {
    // A custom/self-hosted host may legitimately use a non-JWT key; the seed
    // marker is the second defence there. On a real Supabase host we cannot
    // confirm identity without the JWT ref, so fail closed.
    if (isCustomHost) return;
    problems.push(
      `${name} could not be verified as belonging to the approved project (not a decodable Supabase key)`
    );
    return;
  }
  if (claims.role && claims.role !== expectRole) {
    problems.push(`${name} has role "${claims.role}", expected "${expectRole}"`);
  }
  if (ref && !ref.startsWith("host:")) {
    if (!claims.ref) {
      problems.push(`${name} has no project-ref claim — cannot confirm it belongs to ${ref}`);
    } else if (claims.ref !== ref) {
      problems.push(`${name} belongs to project ${claims.ref}, not the resolved project ${ref}`);
    }
  }
}

/**
 * Pure evaluation of the whole non-production contract. Returns
 * { ok, ref, stripeMode, problems }. All problems are safe to print.
 */
export function evaluateNonProduction(env = {}) {
  const problems = [];
  const allowedHosts = splitList(env.E2E_SUPABASE_ALLOWED_HOSTS);
  const allowedRefs = splitList(env.E2E_SUPABASE_ALLOWED_REFS);
  const expectedRef = (env.E2E_SUPABASE_PROJECT_REF || "").trim();
  const productionRef = (env.PRODUCTION_SUPABASE_PROJECT_REF || "").trim();

  let ref = null;
  try {
    const parsed = parseSupabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL, { allowedHosts });
    ref = parsed.ref;
  } catch (e) {
    problems.push(e.message);
  }

  // Required identity inputs — absence is ambiguous, so fail closed.
  if (!expectedRef) {
    problems.push(
      "E2E_SUPABASE_PROJECT_REF is not set (cannot confirm the target is the approved disposable project)"
    );
  }
  if (allowedRefs.length === 0) {
    problems.push(
      "E2E_SUPABASE_ALLOWED_REFS must be a non-empty allowlist of approved disposable project refs"
    );
  }
  if (!productionRef) {
    problems.push(
      "PRODUCTION_SUPABASE_PROJECT_REF is not set (cannot prove the target differs from production)"
    );
  }

  // Identity comparisons (only meaningful once a ref was resolved).
  if (ref) {
    if (allowedRefs.length > 0 && !allowedRefs.includes(ref)) {
      problems.push(`resolved project ref ${ref} is not in E2E_SUPABASE_ALLOWED_REFS`);
    }
    if (expectedRef && ref !== expectedRef) {
      problems.push(
        `resolved project ref ${ref} does not match E2E_SUPABASE_PROJECT_REF ${expectedRef}`
      );
    }
    if (productionRef && ref === productionRef) {
      problems.push(
        `resolved project ref ${ref} equals PRODUCTION_SUPABASE_PROJECT_REF — refusing to touch production`
      );
    }
  }
  if (productionRef && allowedRefs.includes(productionRef)) {
    problems.push("PRODUCTION_SUPABASE_PROJECT_REF must not appear in E2E_SUPABASE_ALLOWED_REFS");
  }
  if (expectedRef && productionRef && expectedRef === productionRef) {
    problems.push("E2E_SUPABASE_PROJECT_REF equals PRODUCTION_SUPABASE_PROJECT_REF");
  }

  // Credentials must belong to the resolved project (non-secret JWT claims).
  const isCustomHost = typeof ref === "string" && ref.startsWith("host:");
  checkCredential(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    decodeSupabaseKeyClaims(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    "anon",
    ref,
    isCustomHost,
    problems
  );
  checkCredential(
    "SUPABASE_SERVICE_ROLE_KEY",
    decodeSupabaseKeyClaims(env.SUPABASE_SERVICE_ROLE_KEY),
    "service_role",
    ref,
    isCustomHost,
    problems
  );

  // Stripe: TEST key only, and no live-mode ids anywhere in fixture env.
  const stripe = evaluateStripeKey(env.STRIPE_SECRET_KEY);
  problems.push(...stripe.problems);
  const liveIds = findLiveStripeIds({
    STRIPE_PRICE_PRO_MONTHLY: env.STRIPE_PRICE_PRO_MONTHLY,
    STRIPE_PRICE_PRO_YEARLY: env.STRIPE_PRICE_PRO_YEARLY,
    STRIPE_TEST_CUSTOMER_ID: env.STRIPE_TEST_CUSTOMER_ID,
  });
  for (const n of liveIds) {
    problems.push(`${n} contains a live-mode Stripe id — fixtures must be TEST mode only`);
  }

  return { ok: problems.length === 0, ref, stripeMode: stripe.mode, problems };
}

/**
 * Second-defence seed marker evaluation (kept out of the seeder so it is unit
 * tested). ok only when a marker row was read AND there was no read error —
 * fails closed on a missing table or any query error.
 */
export function evaluateSeedMarker({ marker, error } = {}) {
  if (error) {
    return { ok: false, reason: `seed marker read error (${error.message ?? "unknown"})` };
  }
  if (!marker || !marker.note) {
    return { ok: false, reason: "no seed marker row — database is not a confirmed non-production target" };
  }
  return { ok: true, note: marker.note };
}

/**
 * Deterministic cleanup lease/namespace for a run's test data, so concurrent or
 * repeated runs can be attributed and torn down without colliding.
 */
export function resolveCleanupLease(env = {}) {
  const id = String(env.E2E_CLEANUP_LEASE || env.GITHUB_RUN_ID || env.BUILD_ID || "local");
  return { leaseId: id, namespace: `mellowa-e2e/${id}` };
}

/**
 * Idempotent teardown plan: the unique row ids to delete. Running it again after
 * a successful delete (empty input) yields { deleteIds: [], done: true }, so a
 * retried cleanup is a safe no-op rather than an error.
 *
 * @param {Array<{ id?: string | null }>} [rows]
 */
export function computeTeardownActions(rows = []) {
  const deleteIds = [...new Set((rows ?? []).map((r) => r?.id).filter(Boolean))];
  return { deleteIds, done: deleteIds.length === 0 };
}

/** Print a name/ref-only report. Never prints a key value or JWT payload. */
export function printReport(result, log = console) {
  log.log("Non-production identity guard (MW-V18-03) — names + opaque ref only:");
  log.log(`  resolved Supabase project ref: ${result.ref ?? "(unresolved)"}`);
  log.log(`  Stripe mode: ${result.stripeMode ?? "(unrecognised)"}`);
  if (result.ok) {
    log.log("  result: OK — target verified as an approved non-production project.");
    return;
  }
  log.log("  result: BLOCKED — the following must be resolved:");
  for (const p of result.problems) log.log(`    - ${p}`);
}

/**
 * Best-effort live Stripe mode probe. Confirms a test-prefixed key is genuinely
 * in test mode via a free, read-only balance call. Hard-fails if the account is
 * live; a network/transient error is a WARNING only (the sk_test_ prefix is
 * already enforced), never a false pass. Loaded dynamically so the pure guard
 * stays dependency-free and can run before `npm ci`.
 */
export async function verifyStripeTestModeSafe(env = {}, log = console) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key || !(key.startsWith("sk_test_") || key.startsWith("rk_test_"))) return;
  let Stripe;
  try {
    ({ default: Stripe } = await import("stripe"));
  } catch {
    log.log("  Stripe probe skipped: stripe SDK not installed yet.");
    return;
  }
  try {
    const stripe = new Stripe(key);
    const balance = await stripe.balance.retrieve();
    if (balance?.livemode === true) {
      throw new GuardError(
        "STRIPE_SECRET_KEY resolves to a LIVE Stripe account despite a test-looking prefix"
      );
    }
    log.log("  Stripe probe: account confirmed in TEST mode.");
  } catch (e) {
    if (e instanceof GuardError) throw e;
    log.log(`  Stripe probe inconclusive (network/transient); relying on sk_test_ prefix.`);
  }
}

/**
 * Full guard. Evaluates identity, prints a safe report, and THROWS GuardError if
 * the environment is not a verified non-production target — so callers fail
 * before any seeding or browser run. Optionally runs the live Stripe probe.
 */
export async function assertNonProductionOrThrow(env = process.env, { log = console, verifyStripeAccount = false } = {}) {
  const result = evaluateNonProduction(env);
  printReport(result, log);
  if (!result.ok) {
    throw new GuardError(
      "BLOCKED: environment failed the non-production identity guard — no seeding or browser run will start."
    );
  }
  if (verifyStripeAccount) await verifyStripeTestModeSafe(env, log);
  return result;
}

// ---- CLI -----------------------------------------------------------------
// `node scripts/nonprod-guard.mjs` — evaluate process.env and exit non-zero if
// the target is not a verified non-production project. Prints names + ref only.
const isMain =
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` ||
    fileURLToPath(import.meta.url) === process.argv[1] ||
    process.argv[1].endsWith("nonprod-guard.mjs"));

if (isMain) {
  const result = evaluateNonProduction(process.env);
  printReport(result, console);
  if (!result.ok) {
    console.error("\nBLOCKED: non-production guard failed. Fix the variables named above.");
    process.exit(1);
  }
  console.log("\nnon-production guard OK.");
}
