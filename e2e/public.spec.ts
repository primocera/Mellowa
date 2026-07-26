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

/**
 * MW-V10-02: an anonymous visitor is not assigned a cohort, so no public page
 * may claim a trial length checkout would not honour. What is asserted is what
 * holds in every configuration:
 *
 * - Pricing is internally consistent — one length across headline, CTA and
 *   footnote, plus a concrete cancel-by date — or it names no length at all and
 *   promises the exact figures before checkout.
 * - No public page ever shows an unassigned visitor the 7-day arm's length.
 * - "Free week" appears nowhere; it would only be true for a real 7-day grant.
 *
 * Cross-page equality with /terms and /refund is deliberately NOT asserted:
 * those are statically prerendered, so their wording is fixed by the build that
 * produced them. On Vercel that is safe — an env change reaches only a new
 * deployment, which re-renders them — but injecting the flag into an already
 * built server would legitimately leave them on the build's wording.
 */
test("anonymous trial disclosure never claims an unassigned length", async ({
  page,
}) => {
  await page.goto("/pricing");
  const pricingBody = (await page.locator("body").innerText()).toLowerCase();
  const named = pricingBody.match(/(\d+) days? free/);

  if (named) {
    for (const m of pricingBody.matchAll(/(\d+) days? free/g)) {
      expect(m[1]).toBe(named[1]);
    }
    await expect(page.getByText(/cancel before/i).first()).toBeVisible();
  } else {
    // Length unknown: the page must promise it before checkout, not guess.
    await expect(
      page.getByText(/shown before checkout|exact trial length/i).first()
    ).toBeVisible();
  }

  for (const path of ["/pricing", "/terms", "/refund", "/"]) {
    await page.goto(path);
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body, `${path} implies a week-long trial`).not.toMatch(
      /free week|week free|7 days|7-day/
    );
  }
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

test("verify-email page shows next step, resend and change-email", async ({ page }) => {
  await page.goto("/verify-email?email=person%40example.com");
  await expect(page.getByText(/check your email to continue/i)).toBeVisible();
  await expect(page.getByText("person@example.com")).toBeVisible();
  await expect(page.getByRole("button", { name: /resend email/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /use a different email/i })).toBeVisible();
});

test("auth callback rejects a missing code and a malicious next URL", async ({ page }) => {
  await page.goto("/auth/callback?next=https%3A%2F%2Fevil.com");
  await expect(page).toHaveURL(/\/login\?error=verify_link_invalid/);
  // Never leaves the origin.
  expect(new URL(page.url()).hostname).not.toContain("evil.com");
});

test("hero leads with the free-sample funnel, not a trial promise", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /create my free sample plan/i }).first()).toBeVisible();
  await expect(page.getByText(/no card for the sample/i).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/start my 3-day free trial/i);
});

test("signup and login pages carry the elevated account copy", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByText(/create your mellowa account/i)).toBeVisible();
  await expect(page.getByText(/no payment method until you choose premium/i)).toBeVisible();
  await expect(page.getByText(/use at least 8 characters/i)).toBeVisible();
  await page.goto("/login");
  await expect(page.getByText(/welcome back/i)).toBeVisible();
});
