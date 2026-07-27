import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Load `.env.local` into the test runner's environment (MW-V11-04).
 *
 * Why this is here: Next.js loads `.env.local` for the app and
 * `scripts/seed-test-user.mjs` has its own loader, but the Playwright process
 * had neither. So setting E2E_SUPABASE_TEST / E2E_TEST_EMAIL /
 * E2E_TEST_PASSWORD in `.env.local` — the obvious place, and the file every
 * other part of this repo reads — configured nothing, and the authenticated
 * suites skipped while looking correctly configured.
 *
 * That is a large part of why those suites went so long without ever running:
 * the failure mode was silence, not an error. Real environment variables still
 * win, so CI secrets and inline overrides are unaffected.
 */
function loadEnvLocal(): void {
  let contents: string;
  try {
    // Playwright loads this config as CommonJS, so `import.meta` is not
    // available here. The config always lives at the project root.
    contents = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return; // Absent is normal in CI, where secrets come from the environment.
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();

/**
 * Playwright config (Prompt 18, audit v5).
 *
 * Free-tier constraints: a single worker (parallel workers exhaust free
 * Supabase connection limits and Vercel Hobby has no CI runners), retries
 * only in CI, screenshots/traces kept on failure.
 *
 * Two tiers of tests:
 *  - e2e/public: run against a production build with placeholder env — no
 *    external services needed. Always run in CI.
 *  - e2e/journeys (signup → trial → billing): require a test Supabase +
 *    Stripe test keys via env; tests skip themselves when not configured.
 */
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // Generous: the first request after `next start` can take >30s on
  // low-resource machines and free CI runners.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    /**
     * Vercel Deployment Protection sits in front of preview deployments and
     * redirects to vercel.com/login, so without this every test would assert
     * against Vercel's login page instead of the app.
     *
     * Set VERCEL_AUTOMATION_BYPASS_SECRET (Vercel → Project → Settings →
     * Deployment Protection → Protection Bypass for Automation) to send the
     * bypass header on every request. The secret is read from the environment
     * and never committed. Omitted entirely when unset, so local runs and
     * unprotected deployments are unaffected.
     */
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          extraHTTPHeaders: {
            "x-vercel-protection-bypass":
              process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
            // Sets a cookie on first response so client-side navigations and
            // asset requests stay authorised too, not just the initial GET.
            "x-vercel-set-bypass-cookie": "true",
          },
        }
      : {}),
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 60_000,
      },
  projects: [
    /*
     * MW-V11-05: performance collection is its own project rather than an
     * env-var gate, so `npm run perf` works identically on Windows and POSIX
     * without adding a cross-env dependency. The viewport projects ignore this
     * spec — running it three times would triple a slow, throttled measurement
     * and produce three numbers for one question.
     */
    {
      name: "perf",
      testMatch: /perf\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Chromium-only (CI installs a single browser); 375px mobile viewport.
    {
      name: "mobile",
      testIgnore: /perf\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop",
      testIgnore: /perf\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // MW-V10-03: 320px is the narrowest viewport we support. It is a separate
    // project rather than a resize inside a test, so every spec that runs here
    // is checked at the width where cards clip and the fixed bottom nav is most
    // likely to cover a primary action.
    {
      name: "mobile-320",
      testIgnore: /perf\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 568 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
