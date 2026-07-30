import { expect, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { type SeedState } from "./matrix";

export { type SeedState } from "./matrix";

/**
 * Shared authenticated-journey harness (MW-V11-04).
 *
 * Why this exists: the first real execution of the authenticated suites found
 * four defects, and every one of them was a test that *looked* green. A fixture
 * used the wrong field names, so Today crashed into the error boundary and the
 * matrix asserted against a broken page. Three tests read authenticated pages
 * without logging in, and one passed anyway because it accepted either branch.
 * An assertion matched a string the app has never rendered.
 *
 * The common thread: a browser test can pass while looking at the wrong page.
 * So this module makes two things mandatory before any journey runs — proof of
 * *where* you are and *who* you are — and one thing mandatory after: proof that
 * nothing failed quietly in the background.
 */

export const E2E_CONFIGURED =
  process.env.E2E_SUPABASE_TEST === "1" &&
  !!process.env.E2E_TEST_EMAIL &&
  !!process.env.E2E_TEST_PASSWORD;

/**
 * The reason a suite is not running, phrased so it reads as BLOCKED rather than
 * passed. CI turns this into an error when RC_GATE is set (see ci.yml): an
 * unrun required suite must never produce a green release candidate.
 */
export const NOT_CONFIGURED_REASON =
  "BLOCKED: seeded test environment absent (E2E_SUPABASE_TEST, E2E_TEST_EMAIL, " +
  "E2E_TEST_PASSWORD). This suite did not run — that is not a pass.";

/**
 * The state the fixture was last seeded into, if the runner was told.
 *
 * MW-V11-04: two required journeys used to decide whether to run by reading the
 * page — "no trial CTA visible, so this user must have used their trial, so
 * skip". That guess is unfalsifiable: a stale locator, a broken seed and a
 * genuinely ineligible user all look identical, and all three produce a skip
 * that reads as a deliberate decision. Naming the state up front means a skip
 * can only ever mean "the fixture I need was not seeded", and says which one.
 */
export const SEEDED_STATE = process.env.E2E_SEED_STATE as SeedState | undefined;

/** Reason text for a journey whose required fixture is not the current one. */
export function needsState(required: SeedState): string {
  return (
    `BLOCKED: needs the "${required}" fixture; ` +
    `E2E_SEED_STATE is ${SEEDED_STATE ? `"${SEEDED_STATE}"` : "unset"}. ` +
    `Run: node scripts/seed-test-user.mjs --state=${required}`
  );
}

/** Rebuild the synthetic user into a known state. States cannot leak. */
export function seed(state: SeedState): void {
  execFileSync("node", ["scripts/seed-test-user.mjs", `--state=${state}`], {
    stdio: "pipe",
  });
}

// ---------------------------------------------------------------------------
// Failure guards
// ---------------------------------------------------------------------------

export interface PageFailures {
  consoleErrors: string[];
  pageErrors: string[];
  badResponses: string[];
}

/**
 * Requests whose failure is expected and must not fail a test.
 *
 * Deliberately short and specific. A broad allowlist here would quietly restore
 * exactly the blindness this module exists to remove, so each entry names a
 * thing that is *supposed* to 4xx.
 */
const EXPECTED_FAILURES: RegExp[] = [
  /\/favicon\.ico$/,
  // Auth probes: an unauthenticated session check legitimately returns 401.
  /\/auth\/v1\/user$/,
];

/**
 * Attach listeners that record anything the page did wrong in the background.
 *
 * A journey that "passes" while the console is full of React errors, or while a
 * required API call returned 500 and the UI silently rendered an empty state,
 * is not evidence that the journey works.
 */
export function installFailureGuards(page: Page): PageFailures {
  const failures: PageFailures = {
    consoleErrors: [],
    pageErrors: [],
    badResponses: [],
  };

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (EXPECTED_FAILURES.some((pattern) => pattern.test(text))) return;
    failures.consoleErrors.push(text);
  });

  // An uncaught exception in the page. React swallows some of these into an
  // error boundary, which is why assertNoErrorBoundary exists as well.
  page.on("pageerror", (error) => {
    failures.pageErrors.push(error.message);
  });

  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    const url = response.url();
    if (EXPECTED_FAILURES.some((pattern) => pattern.test(url))) return;
    failures.badResponses.push(`${status} ${url}`);
  });

  return failures;
}

/**
 * Fail the test if anything was recorded. Called from an afterEach so a journey
 * cannot pass while the page was breaking underneath it.
 */
export function assertNoBackgroundFailures(failures: PageFailures): void {
  expect(
    failures.pageErrors,
    `uncaught page errors: ${failures.pageErrors.join(" | ")}`
  ).toEqual([]);
  expect(
    failures.consoleErrors,
    `console errors: ${failures.consoleErrors.join(" | ")}`
  ).toEqual([]);
  expect(
    failures.badResponses,
    `unexpected HTTP failures: ${failures.badResponses.join(" | ")}`
  ).toEqual([]);
}

/**
 * The specific false-green that cost the most: Today crashed into the global
 * error boundary because the seed fixture used the wrong field names, and the
 * matrix happily asserted against the error screen.
 */
export async function assertNoErrorBoundary(page: Page): Promise<void> {
  const body = await page.locator("body").innerText();
  for (const marker of [
    /something went wrong/i,
    /unexpected error/i,
    /application error/i,
    /digest:/i,
  ]) {
    expect(body, `page is showing an error boundary (${marker})`).not.toMatch(marker);
  }
}

// ---------------------------------------------------------------------------
// Identity assertions — prove where you are before asserting what you see
// ---------------------------------------------------------------------------

export interface Identity {
  /** The route the browser must actually be on. */
  route: RegExp;
  /** A heading that proves the page rendered its own content. */
  heading?: RegExp;
  /** Text that must be present — the seeded state's signature. */
  expect?: RegExp[];
  /** Text that must be absent. */
  reject?: RegExp[];
}

/**
 * Assert the page is who and where it claims to be, before the journey starts.
 *
 * The redirect case is the one that matters most: an expired session sends
 * every authenticated route to /login, and a test that only checks for the
 * absence of an element will pass on the login page forever.
 */
export async function assertIdentity(page: Page, identity: Identity): Promise<void> {
  await expect(page).toHaveURL(identity.route);

  // A signed-out redirect is the most common wrong page, so name it explicitly
  // rather than letting the URL assertion produce a cryptic diff.
  expect(page.url(), "redirected to sign-in — the session was not established").not.toMatch(
    /\/login/
  );

  if (identity.heading) {
    await expect(page.getByRole("heading", { name: identity.heading }).first()).toBeVisible();
  }

  // Retrying, for the same reason as assertSeededState: a one-shot read here
  // raced the loading boundaries and reported missing content that was simply
  // not rendered yet.
  for (const pattern of identity.expect ?? []) {
    await expect(
      page.locator("body"),
      `expected page to contain ${pattern}`
    ).toContainText(pattern);
  }

  // Absence checks run last, once the page has settled — asserting that
  // something is absent before the page renders would pass for the wrong
  // reason, which is exactly the false green this harness exists to remove.
  await assertNoErrorBoundary(page);

  const body = await page.locator("body").innerText();
  for (const pattern of identity.reject ?? []) {
    expect(body, `expected page NOT to contain ${pattern}`).not.toMatch(pattern);
  }
}

/**
 * Assert the seeded fixture is in the state the test requires.
 *
 * This replaces the pattern of *skipping* when the fixture looks wrong. A skip
 * on an unexpected fixture state is indistinguishable from a skip on a broken
 * seed, and it silently removes coverage from a required journey — the exact
 * thing the release gate is supposed to catch.
 */
export async function assertSeededState(
  page: Page,
  state: SeedState,
  signature: RegExp
): Promise<void> {
  /*
   * Retrying assertion, not a one-shot read.
   *
   * The first version called `innerText()` once, immediately after navigation.
   * That raced the loading boundaries MW-V10-07 added: the body contained the
   * nav and the trial banner and nothing else yet, so every state reported
   * "the fixture did not apply" when the fixture had applied perfectly well and
   * the page simply had not finished rendering. 21 of 33 journeys failed that
   * way — a false negative, which is the mirror image of the false greens this
   * harness exists to prevent, and just as misleading.
   *
   * `toContainText` polls until the expect timeout, so it waits for content
   * without a fixed sleep.
   */
  await expect(
    page.locator("body"),
    `seeded state "${state}" is not present on the page — the fixture did not apply, ` +
      "so this journey would have tested nothing"
  ).toContainText(signature);
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Log in and prove it worked.
 *
 * Every Playwright test gets a fresh context, so a test that reads an
 * authenticated page must log in itself. Two tests once asserted against pages
 * that had silently redirected to /login, and one passed anyway.
 */
export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill('input[type="email"]', process.env.E2E_TEST_EMAIL!);
  await page.fill('input[type="password"]', process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/(today|dashboard|onboarding)/, { timeout: 30_000 });

  // The consent checkpoint gates every authenticated surface for an
  // un-consented account. Clear it once so later assertions test the product
  // rather than the checkpoint.
  const checkpoint = page.getByText(/a quick confirmation/i);
  if (await checkpoint.isVisible().catch(() => false)) {
    for (const box of await page.locator('input[type="checkbox"]').all()) {
      await box.check();
    }
    await page.getByRole("button", { name: /confirm and continue/i }).click();
    await expect(checkpoint).toBeHidden();
  }

  // Proof of session, not just proof of navigation.
  expect(page.url(), "login did not leave the sign-in page").not.toMatch(/\/login/);
}

/** No element may push the document wider than the viewport. */
export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  expect(overflow, "page scrolls horizontally").toBe(false);
}

/**
 * Record a retry in the test annotations so the handoff can report it.
 * A journey that only passes on its second attempt is a finding, not a pass.
 */
export function annotateRetry(testInfo: TestInfo): void {
  if (testInfo.retry > 0) {
    testInfo.annotations.push({
      type: "retry",
      description: `passed on attempt ${testInfo.retry + 1} — investigate before trusting it`,
    });
  }
}
