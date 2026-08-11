import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkEnvContract } from "../scripts/check-env-contract.mjs";

/**
 * MW-V17-01: the authenticated release matrix could never run because the
 * RC/CI workflows mapped GitHub secrets to names the runner/seeder/harness never
 * read (E2E_TEST_USER_EMAIL vs E2E_TEST_EMAIL, no E2E_SUPABASE_TEST, no
 * STRIPE_SECRET_KEY). This locks the one canonical contract so any future drift —
 * a renamed secret, a dropped flag, a legacy alias re-introduced as a runtime
 * key — fails here instead of silently reporting "seeded environment absent".
 */

const ROOT = join(__dirname, "..");
const realRead = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Read real files, but substitute drifted content for the named ones. */
const withOverrides =
  (overrides: Record<string, string>) => (rel: string) =>
    rel in overrides ? overrides[rel] : realRead(rel);

const RC = ".github/workflows/release-candidate.yml";

describe("authenticated E2E env contract parity", () => {
  it("workflow, runner, seeder, Playwright and docs all agree (real files)", () => {
    const { ok, problems } = checkEnvContract();
    expect(problems, problems.join("\n")).toEqual([]);
    expect(ok).toBe(true);
  });

  it("fails closed when the matrix step uses the legacy alias as a runtime key", () => {
    const drifted = realRead(RC).replace(
      "E2E_TEST_EMAIL: ${{ secrets.E2E_TEST_USER_EMAIL }}",
      "E2E_TEST_USER_EMAIL: ${{ secrets.E2E_TEST_USER_EMAIL }}"
    );
    const { ok, problems } = checkEnvContract(withOverrides({ [RC]: drifted }));
    expect(ok).toBe(false);
    expect(problems.join("\n")).toMatch(/E2E_TEST_EMAIL must map|forbidden runtime key E2E_TEST_USER_EMAIL/);
  });

  it("fails closed when the E2E_SUPABASE_TEST=1 flag is dropped", () => {
    const drifted = realRead(RC).replace(/E2E_SUPABASE_TEST:\s*"1"/g, "");
    const { ok, problems } = checkEnvContract(withOverrides({ [RC]: drifted }));
    expect(ok).toBe(false);
    expect(problems.join("\n")).toMatch(/E2E_SUPABASE_TEST/);
  });

  it("fails closed when a Stripe TEST-key requirement is removed", () => {
    const drifted = realRead(RC).replace(/sk_test_/g, "sk_xxxx_");
    const { ok, problems } = checkEnvContract(withOverrides({ [RC]: drifted }));
    expect(ok).toBe(false);
    expect(problems.join("\n")).toMatch(/Stripe TEST key/);
  });

  it("fails closed when a required RC preflight secret is missing", () => {
    const drifted = realRead(RC).replace(/E2E_STRIPE_SECRET_KEY/g, "REMOVED_SECRET");
    const { ok, problems } = checkEnvContract(withOverrides({ [RC]: drifted }));
    expect(ok).toBe(false);
    expect(problems.join("\n")).toMatch(/E2E_STRIPE_SECRET_KEY|STRIPE_SECRET_KEY must map/);
  });

  it("fails closed when a consumer reads a forbidden legacy alias", () => {
    const seeder = realRead("scripts/run-auth-matrix.mjs").replace(
      'process.env.E2E_TEST_EMAIL',
      'process.env.E2E_TEST_USER_EMAIL'
    );
    const { ok, problems } = checkEnvContract(
      withOverrides({ "scripts/run-auth-matrix.mjs": seeder })
    );
    expect(ok).toBe(false);
    expect(problems.join("\n")).toMatch(/forbidden legacy alias E2E_TEST_USER_EMAIL|does not reference E2E_TEST_EMAIL/);
  });
});
