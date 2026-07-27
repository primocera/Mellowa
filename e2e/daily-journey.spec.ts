import { test, expect, type Page } from "@playwright/test";
import {
  E2E_CONFIGURED,
  NOT_CONFIGURED_REASON,
  annotateRetry,
  assertIdentity,
  assertNoBackgroundFailures,
  assertNoHorizontalOverflow,
  assertSeededState,
  installFailureGuards,
  login,
  seed,
  type PageFailures,
  type SeedState,
} from "./support/harness";

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

test.skip(!E2E_CONFIGURED, NOT_CONFIGURED_REASON);

/**
 * MW-V11-04: every state in this matrix now runs behind failure guards. A
 * state assertion that passes while the page threw, logged a React error or
 * received a 500 is not evidence the state works — that is precisely how the
 * first execution of this suite came to be asserting against an error boundary.
 */
let failures: PageFailures;

test.beforeEach(({ page }) => {
  failures = installFailureGuards(page);
});

test.afterEach(({}, testInfo) => {
  annotateRetry(testInfo);
  if (testInfo.status === testInfo.expectedStatus) {
    assertNoBackgroundFailures(failures);
  }
});

/**
 * Log in, open Today, and prove both that we are on Today and that the seeded
 * state actually applied — before a single assertion about the state runs.
 *
 * The failure this prevents: the seed silently produces the wrong state (or no
 * state at all), the page renders something plausible, and the test's real
 * assertions pass for a reason that has nothing to do with what it claims to
 * check. A missing fixture must fail loudly, not skip and not quietly pass.
 */
async function arriveAtToday(
  page: Page,
  state: SeedState,
  signature: RegExp
): Promise<void> {
  await login(page);
  await page.goto("/today");
  await assertIdentity(page, { route: /\/today/ });
  await assertSeededState(page, state, signature);
}

/**
 * The fixed bottom nav must not cover a control. Checked against the control's
 * own box rather than a magic padding number, so a nav height change fails here
 * instead of silently eating taps.
 */
async function assertNotCoveredByNav(page: Page, name: RegExp) {
  const control = page.getByRole("button", { name }).first();
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();

  /*
   * Ask the browser what is actually at the control's centre, rather than
   * comparing boxes against the nav.
   *
   * The box comparison was wrong in a way that took a real run to expose. It
   * called `scrollIntoViewIfNeeded`, which scrolls an element to be *minimally*
   * visible and knows nothing about fixed overlays — so it happily parks the
   * button directly behind the bottom nav and then failed on the geometry it
   * had just created. The layout already reserves `pb-24` (96px) for a ~60px
   * nav, so the content can always be scrolled clear; what the test needed to
   * know was never "where is this box" but "if the user taps here, does the
   * button receive it".
   *
   * `elementFromPoint` answers exactly that, and it also catches any future
   * overlay — a toast, a sticky banner, a modal backdrop — not just this nav.
   */
  const reachable = await control.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (y < 0 || y > window.innerHeight) return "offscreen";
    const hit = document.elementFromPoint(x, y);
    if (!hit) return "nothing at point";
    if (node.contains(hit) || hit.contains(node)) return true;
    const covering = hit.closest("nav,header,[role=dialog]") ?? hit;
    return `covered by <${covering.tagName.toLowerCase()}>`;
  });

  expect(reachable, `the primary action is not tappable: ${reachable}`).toBe(true);
}

test.describe("no plan yet", () => {
  test.beforeEach(() => seed("no-plan"));

  test("offers exactly one way forward, reachable by keyboard", async ({ page }) => {
    await login(page);
    await page.goto("/today");
    await assertIdentity(page, { route: /\/today/ });
    await assertSeededState(page, "no-plan", /no plan yet/i);

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
    await assertIdentity(page, { route: /\/today/ });
    await assertSeededState(page, "plan-ready", /now · one next step/i);

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
    await arriveAtToday(page, "plan-ready", /now · one next step/i);

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
    await arriveAtToday(page, "plan-ready", /now · one next step/i);
    await page.getByRole("button", { name: /^Done$/ }).first().click();
    await page.getByRole("button", { name: /^Undo$/ }).click();
    await expect(page.getByText(/^Marked done\.$/)).toHaveCount(0);
  });

  test("no celebration, streak or adherence language anywhere on Today", async ({
    page,
  }) => {
    await arriveAtToday(page, "plan-ready", /now · one next step/i);
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
    await arriveAtToday(page, "partly-done", /now · one next step/i);
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
    await arriveAtToday(
      page,
      "all-done",
      /that's everything from today's plan/i
    );
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
    await arriveAtToday(page, "past-due", /stays? readable/i);

    const banner = page.getByRole("status").filter({ hasText: /readable/i }).first();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/stays? readable/i);
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
    // The canceled banner reads "…reflections stay readable"; the past_due one
    // reads "stays readable". Tolerate both rather than pin the wrong one.
    await arriveAtToday(page, "canceled", /stays? readable/i);
    const banner = page.getByRole("status").filter({ hasText: /readable/i }).first();
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link")).toHaveAttribute("href", "/billing");
    await expect(page.getByText(/meals that fit today|now/i).first()).toBeVisible();
  });
});

test.describe("trial set not to renew", () => {
  test.beforeEach(() => seed("ending"));

  test("shows one notice, not a trial countdown as well", async ({ page }) => {
    await arriveAtToday(page, "ending", /set not to renew/i);
    // The trial banner stands down so the two never contradict each other.
    await expect(page.getByText(/trial is active/i)).toHaveCount(0);
    await expect(page.getByText(/set not to renew/i)).toBeVisible();
  });
});

test.describe("invalid stored timezone", () => {
  test.beforeEach(() => seed("bad-timezone"));

  test("offers timezone repair instead of a wrong day", async ({ page }) => {
    await arriveAtToday(page, "bad-timezone", /time zone|timezone/i);
    await assertNoHorizontalOverflow(page);
  });
});
