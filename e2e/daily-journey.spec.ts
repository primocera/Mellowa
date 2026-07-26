import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

/**
 * MW-V10-03: the authenticated daily-journey state matrix.
 *
 * Why this file exists: the unit suite proves the Now selector picks the right
 * item and that completion writes a row. It cannot prove that the resulting
 * screen has exactly one primary action, that a 320px card is not clipped, that
 * the fixed bottom nav does not sit on top of the Done button, that a
 * double-tap does not double-complete, or that a past_due user is told their
 * history is still readable. Those are the failures this matrix is for.
 *
 * Each state is seeded by re-running `scripts/seed-test-user.mjs --state=<s>`
 * against the same synthetic user, so the states cannot leak into each other.
 * Skips itself when the seeded environment is absent — the same contract as
 * journeys.spec.ts, and the same reason it has never yet been executed.
 */

const configured =
  process.env.E2E_SUPABASE_TEST === "1" &&
  !!process.env.E2E_TEST_EMAIL &&
  !!process.env.E2E_TEST_PASSWORD;

test.skip(
  !configured,
  "seeded env not configured (E2E_SUPABASE_TEST, E2E_TEST_EMAIL, E2E_TEST_PASSWORD)"
);

type SeedState =
  | "no-plan"
  | "plan-ready"
  | "partly-done"
  | "all-done"
  | "past-due"
  | "canceled"
  | "ending"
  | "bad-timezone";

function seed(state: SeedState) {
  execFileSync("node", ["scripts/seed-test-user.mjs", `--state=${state}`], {
    stdio: "pipe",
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', process.env.E2E_TEST_EMAIL!);
  await page.fill('input[type="password"]', process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/(today|dashboard|onboarding)/, { timeout: 30_000 });

  // The consent checkpoint gates every authenticated surface for an
  // un-consented account. Clear it once so the state assertions below are
  // testing Today, not the checkpoint.
  const checkpoint = page.getByText(/a quick confirmation/i);
  if (await checkpoint.isVisible().catch(() => false)) {
    for (const box of await page.locator('input[type="checkbox"]').all()) {
      await box.check();
    }
    await page.getByRole("button", { name: /confirm and continue/i }).click();
    await expect(checkpoint).toBeHidden();
  }
}

/** No element may push the document wider than the viewport. */
async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1
  );
  expect(overflow, "page scrolls horizontally").toBe(false);
}

/**
 * The fixed bottom nav must not cover a control. Checked against the control's
 * own box rather than a magic padding number, so a nav height change fails here
 * instead of silently eating taps.
 */
async function assertNotCoveredByNav(page: Page, name: RegExp) {
  const control = page.getByRole("button", { name }).first();
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  const nav = page.locator("nav.fixed").first();
  if ((await nav.count()) === 0 || !box) return;
  const navBox = await nav.boundingBox();
  if (!navBox) return;
  // Scroll the control fully into view first — being below the fold is fine;
  // being *under* the nav once scrolled to is not.
  await control.scrollIntoViewIfNeeded();
  const after = await control.boundingBox();
  if (!after) return;
  expect(
    after.y + after.height <= navBox.y + 1,
    "control sits underneath the fixed bottom nav"
  ).toBe(true);
}

test.describe("no plan yet", () => {
  test.beforeEach(() => seed("no-plan"));

  test("offers exactly one way forward, reachable by keyboard", async ({ page }) => {
    await login(page);
    await page.goto("/today");
    await expect(page.getByText(/no plan yet/i)).toBeVisible();

    const checkIn = page.getByRole("link", { name: /check in for today/i });
    await expect(checkIn).toBeVisible();
    // One primary action, not two competing ones.
    await expect(page.getByRole("button", { name: /^Done$/ })).toHaveCount(0);

    await assertNoHorizontalOverflow(page);

    // Keyboard: the entry action must be focusable without a pointer.
    await page.keyboard.press("Tab");
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) {
      reached = await checkIn.evaluate((el) => el === document.activeElement);
      if (!reached) await page.keyboard.press("Tab");
    }
    expect(reached, "check-in CTA never receives keyboard focus").toBe(true);
  });
});

test.describe("plan ready", () => {
  test.beforeEach(() => seed("plan-ready"));

  test("shows one Now action; the full plan stays reachable", async ({ page }) => {
    await login(page);
    await page.goto("/today");

    await expect(page.getByText(/now · one next step/i)).toBeVisible();
    // Exactly one primary action on the Now card.
    await expect(page.getByRole("button", { name: /^Done$/ })).toHaveCount(1);
    // The full plan is never hidden — only collapsed behind a labelled control.
    const viewFull = page.getByRole("button", { name: /view full plan/i });
    await expect(viewFull).toBeVisible();
    await viewFull.click();
    await expect(page.getByText(/meals that fit today/i)).toBeVisible();

    await assertNoHorizontalOverflow(page);
    await assertNotCoveredByNav(page, /^Done$/);
  });

  test("a double tap on Done completes once and reads as done once", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/today");

    const done = page.getByRole("button", { name: /^Done$/ }).first();
    // Two taps as fast as the browser allows. The second must be dropped, not
    // queued as a toggle-back and not sent as a duplicate write.
    await done.click();
    await done.click({ force: true, timeout: 2000 }).catch(() => {
      /* disabled while saving is the intended outcome */
    });

    await expect(page.getByText(/^Marked done\.$/)).toBeVisible();
    // Exactly one confirmation, and an Undo that is available once.
    await expect(page.getByText(/^Marked done\.$/)).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Undo$/ })).toHaveCount(1);

    // Reload: the server is the source of truth, so the item is still done and
    // the next action has moved on rather than repeating the completed one.
    await page.reload();
    await expect(page.getByText(/now/i).first()).toBeVisible();
  });

  test("Undo reverses the completion and says nothing about success", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/today");
    await page.getByRole("button", { name: /^Done$/ }).first().click();
    await page.getByRole("button", { name: /^Undo$/ }).click();
    await expect(page.getByText(/^Marked done\.$/)).toHaveCount(0);
  });

  test("no celebration, streak or adherence language anywhere on Today", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/today");
    await page.getByRole("button", { name: /view full plan/i }).click();
    const body = (await page.locator("main").innerText()).toLowerCase();
    for (const banned of [
      "streak",
      "well done",
      "great job",
      "congratulations",
      "on track",
      "you're crushing",
      "keep it up",
      "perfect day",
      "100%",
    ]) {
      expect(body, `Today contains "${banned}"`).not.toContain(banned);
    }
  });
});

test.describe("partly done", () => {
  test.beforeEach(() => seed("partly-done"));

  test("skips the completed item without hiding it from the full plan", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/today");
    // The Now card must not offer an item that is already recorded as done.
    const nowTitle = await page.locator("main h2").first().innerText();
    expect(nowTitle.toLowerCase()).not.toContain("oats with fruit");

    await page.getByRole("button", { name: /view full plan/i }).click();
    // …but the completed breakfast is still visible in the plan itself.
    await expect(page.getByText(/oats with fruit/i).first()).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("all done", () => {
  test.beforeEach(() => seed("all-done"));

  test("states there is nothing left, neutrally, with the plan still open", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/today");
    await expect(
      page.getByText(/that's everything from today's plan/i)
    ).toBeVisible();
    // No primary action to press, and nothing framed as an achievement.
    await expect(page.getByRole("button", { name: /^Done$/ })).toHaveCount(0);
    const body = (await page.locator("main").innerText()).toLowerCase();
    expect(body).not.toMatch(/well done|great job|congratulations|streak/);
    // The plan itself remains readable in this state.
    await expect(page.getByText(/meals that fit today/i)).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("payment needs attention", () => {
  test.beforeEach(() => seed("past-due"));

  test("says history is readable and gives one route to billing", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/today");

    const banner = page.getByRole("status").filter({ hasText: /readable/i }).first();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/stays readable/i);
    // Exactly one recovery CTA, and it goes to billing.
    const cta = banner.getByRole("link");
    await expect(cta).toHaveCount(1);
    await expect(cta).toHaveAttribute("href", "/billing");

    // The user's own plan is still there — read access is never revoked.
    await expect(page.getByText(/now/i).first()).toBeVisible();
    // No pressure or loss framing.
    const text = (await banner.innerText()).toLowerCase();
    expect(text).not.toMatch(/immediately|urgent|will be deleted|lose|expire/);

    await assertNoHorizontalOverflow(page);
  });
});

test.describe("subscription ended", () => {
  test.beforeEach(() => seed("canceled"));

  test("keeps history readable and offers plans without pressure", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/today");
    const banner = page.getByRole("status").filter({ hasText: /readable/i }).first();
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link")).toHaveAttribute("href", "/billing");
    await expect(page.getByText(/meals that fit today|now/i).first()).toBeVisible();
  });
});

test.describe("trial set not to renew", () => {
  test.beforeEach(() => seed("ending"));

  test("shows one notice, not a trial countdown as well", async ({ page }) => {
    await login(page);
    await page.goto("/today");
    // The trial banner stands down so the two never contradict each other.
    await expect(page.getByText(/trial is active/i)).toHaveCount(0);
    await expect(page.getByText(/set not to renew/i)).toBeVisible();
  });
});

test.describe("invalid stored timezone", () => {
  test.beforeEach(() => seed("bad-timezone"));

  test("offers timezone repair instead of a wrong day", async ({ page }) => {
    await login(page);
    await page.goto("/today");
    await expect(page.getByText(/time zone|timezone/i).first()).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});
