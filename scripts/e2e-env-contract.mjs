/**
 * Canonical authenticated-E2E environment contract (MW-V17-01).
 *
 * One source of truth for the environment-variable names the authenticated
 * release matrix uses. Before this, the RC/CI workflows mapped GitHub secrets to
 * names the runner/seeder/harness never read (E2E_TEST_USER_EMAIL vs
 * E2E_TEST_EMAIL, no E2E_SUPABASE_TEST, no STRIPE_SECRET_KEY), so the matrix
 * reported "seeded environment absent" and the RC could never actually run.
 *
 * `scripts/check-env-contract.mjs` and `tests/env-contract-parity.test.ts` both
 * import this so drift fails a test instead of silently blocking a candidate.
 */

/**
 * The runtime environment-variable names the app, runner, seeder, Playwright
 * config and journeys harness consume. These are what MUST be set at test time.
 */
export const CANONICAL_RUNTIME = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "E2E_SUPABASE_TEST",
  "E2E_TEST_EMAIL",
  "E2E_TEST_PASSWORD",
  "STRIPE_SECRET_KEY",
];

/**
 * GitHub secret name → canonical runtime name. The ONLY place the two sets of
 * names are allowed to differ: a workflow reads `secrets.<LEFT>` and exports it
 * as `<RIGHT>`. `E2E_SUPABASE_TEST` is not in here — it is the constant "1".
 */
export const SECRET_TO_RUNTIME = {
  E2E_SUPABASE_URL: "NEXT_PUBLIC_SUPABASE_URL",
  E2E_SUPABASE_ANON_KEY: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  E2E_SUPABASE_SERVICE_ROLE_KEY: "SUPABASE_SERVICE_ROLE_KEY",
  E2E_TEST_USER_EMAIL: "E2E_TEST_EMAIL",
  E2E_TEST_USER_PASSWORD: "E2E_TEST_PASSWORD",
  E2E_STRIPE_SECRET_KEY: "STRIPE_SECRET_KEY",
};

/** GitHub secret names the RC preflight requires to be present. */
export const REQUIRED_SECRETS_FOR_RC = Object.keys(SECRET_TO_RUNTIME);

/**
 * Legacy runtime aliases that must NEVER be consumed by the runner/seeder/
 * harness or exported to the app as a runtime var. They are valid only as the
 * left-hand `secrets.<NAME>` source in a workflow. If one of these appears as an
 * env KEY passed to the app or is read via process.env by a consumer, that is
 * the exact drift that silently blocked the matrix.
 */
export const FORBIDDEN_RUNTIME_ALIASES = [
  "E2E_TEST_USER_EMAIL",
  "E2E_TEST_USER_PASSWORD",
  "E2E_SUPABASE_URL",
  "E2E_SUPABASE_ANON_KEY",
  "E2E_SUPABASE_SERVICE_ROLE_KEY",
  "E2E_STRIPE_SECRET_KEY",
];
