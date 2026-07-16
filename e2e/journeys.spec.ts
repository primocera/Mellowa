import { test, expect } from "@playwright/test";

/**
 * Authenticated paid-journey suite (Prompt 18). Requires a TEST Supabase
 * project (never production) via E2E_SUPABASE_TEST=1 plus E2E_TEST_EMAIL /
 * E2E_TEST_PASSWORD of a pre-seeded confirmed user. Skips itself when not
 * configured so CI on the free tier stays green without secrets.
 *
 * Full Stripe checkout/webhook cycles need `stripe listen` and test keys —
 * covered by docs/testing.md manual runbook until a dedicated test env
 * exists (tracked for the go/no-go audit).
 */

const configured =
  process.env.E2E_SUPABASE_TEST === "1" &&
  !!process.env.E2E_TEST_EMAIL &&
  !!process.env.E2E_TEST_PASSWORD;

test.skip(!configured, "E2E test Supabase not configured (E2E_SUPABASE_TEST, E2E_TEST_EMAIL, E2E_TEST_PASSWORD)");

test("login → dashboard → consent state → settings data controls", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', process.env.E2E_TEST_EMAIL!);
  await page.fill('input[type="password"]', process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/dashboard|today|onboarding/);

  // Consent checkpoint appears for un-consented accounts and can be completed.
  const checkpoint = page.getByText(/a quick confirmation/i);
  if (await checkpoint.isVisible().catch(() => false)) {
    for (const box of await page.locator('input[type="checkbox"]').all()) {
      await box.check();
    }
    await page.getByRole("button", { name: /confirm and continue/i }).click();
    await expect(checkpoint).toBeHidden();
  }

  // Settings shows billing, support and data controls (export/delete).
  await page.goto("/settings");
  await expect(page.getByText(/subscription/i).first()).toBeVisible();
  await expect(page.getByText(/support@/i).first()).toBeVisible();
  await expect(page.getByText(/export/i).first()).toBeVisible();
});

test("pricing reflects trial state for the signed-in user", async ({ page }) => {
  await page.goto("/pricing");
  // Either trial copy (eligible) or pay-today copy (used) — never both.
  const trial = await page.getByText(/start 3-day free trial/i).count();
  const payToday = await page.getByText(/pay today/i).count();
  expect(trial > 0 || payToday > 0).toBe(true);
  expect(trial > 0 && payToday > 0).toBe(false);
});
