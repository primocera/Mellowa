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
  ],
});
