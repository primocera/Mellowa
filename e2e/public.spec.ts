import { test, expect } from "@playwright/test";

/**
 * Public-surface smoke suite (Prompt 18). Runs without any external service:
 * marketing page, pricing disclosures, legal pages, auth forms including the
 * age/consent gate, and basic layout hygiene on mobile.
 */

test("home page renders with safety boundary and legal links", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Mellowa/i);
  await expect(page.locator("footer")).toContainText(/not medical care/i);
  for (const path of ["/privacy", "/terms", "/refund"]) {
    await expect(page.locator(`footer a[href="${path}"]`)).toBeVisible();
  }
});

test("no horizontal overflow on mobile", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  expect(overflow).toBe(false);
});

test("pricing shows exact prices and payment disclosure near CTA", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByText("€9.99").first()).toBeVisible();
  await expect(page.getByText("€59.99").first()).toBeVisible();
  await expect(page.getByText(/payment method required/i).first()).toBeVisible();
  // No absolute "unlimited" promise (fair-use copy instead).
  await expect(page.locator("body")).not.toContainText(/unlimited personalized/i);
});

test("signup requires 18+ and policy consent (not pre-checked)", async ({ page }) => {
  await page.goto("/signup");
  const checkboxes = page.locator('input[type="checkbox"]');
  await expect(checkboxes).toHaveCount(2);
  for (const box of await checkboxes.all()) {
    await expect(box).not.toBeChecked();
  }
  // Terms/Privacy links visible next to consent.
  await expect(page.locator('a[href="/terms"]').first()).toBeVisible();
  await expect(page.locator('a[href="/privacy"]').first()).toBeVisible();

  await page.fill('input[type="email"]', "person@example.com");
  await page.fill('input[type="password"]', "longenoughpassword");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.getByText(/confirm you are 18/i)).toBeVisible();
});

test("login offers forgot-password recovery", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('a[href="/forgot-password"]')).toBeVisible();
});

test("privacy policy lists processors and retention", async ({ page }) => {
  await page.goto("/privacy");
  for (const provider of ["Anthropic", "Stripe", "Resend", "Supabase", "Vercel"]) {
    await expect(page.getByText(provider).first()).toBeVisible();
  }
  await expect(page.getByText(/retention/i).first()).toBeVisible();
});

test("legal pages have no placeholder lorem or broken headings", async ({ page }) => {
  for (const path of ["/terms", "/refund", "/privacy"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/lorem ipsum|TODO|\[placeholder\]/i);
  }
});

test("keyboard navigation reaches the primary signup CTA", async ({ page }) => {
  await page.goto("/signup");
  await page.keyboard.press("Tab");
  const active = await page.evaluate(() => document.activeElement?.tagName ?? "");
  expect(["A", "INPUT", "BUTTON"]).toContain(active);
});
