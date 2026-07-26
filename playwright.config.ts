import { defineConfig, devices } from "@playwright/test";

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
    // Chromium-only (CI installs a single browser); 375px mobile viewport.
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
      },
    },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // MW-V10-03: 320px is the narrowest viewport we support. It is a separate
    // project rather than a resize inside a test, so every spec that runs here
    // is checked at the width where cards clip and the fixed bottom nav is most
    // likely to cover a primary action.
    {
      name: "mobile-320",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 568 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
