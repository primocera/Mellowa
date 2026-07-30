/**
 * The canonical authenticated test matrix (MW-V12-02).
 *
 * One source of truth for two questions that used to be answered in scattered
 * places, or not at all:
 *   1. Which user states must the authenticated suites cover?
 *   2. Which journeys run against each state, and are they actually authored?
 *
 * Before this file, the states lived in `harness.ts` as a bare union, the
 * journeys lived as test titles across two spec files, and nothing tied the two
 * together — so a required journey could be renamed, a fixture could stop being
 * produced, and the suite would still look complete. `tests/e2e-matrix-
 * integrity.test.ts` reads THIS module and the spec files and fails the build if
 * they drift apart, which is the guarantee the accepted-risk note asked for:
 * "required tests cannot silently become unreachable after copy or selector
 * changes."
 *
 * Pure module — no `@playwright/test` import — so the vitest integrity test can
 * load it without pulling the browser runner into the unit suite. `harness.ts`
 * imports `SeedState` from here, not the other way round.
 */

/**
 * Every fixture state the seed script can construct. Kept in lockstep with
 * `scripts/seed-test-user.mjs` (VALID_STATES) by the integrity test — adding a
 * state in one place and not the other fails the build.
 */
export const SEED_STATES = [
  "no-plan",
  "plan-ready",
  "partly-done",
  "all-done",
  "past-due",
  "canceled",
  "ending",
  "bad-timezone",
  "trial-eligible",
  "trial-used",
  "active",
  "sample-used",
] as const;

export type SeedState = (typeof SEED_STATES)[number];

/** A subscription / entitlement state the product genuinely distinguishes. */
export interface UserState {
  /** Stable id. */
  id: string;
  /** The seed fixture that constructs it. */
  fixture: SeedState;
  /** Stripe status or "none" (no subscription row). */
  stripeStatus:
    | "none"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled";
  /** What the product does in this state, in one line. */
  meaning: string;
}

/**
 * The subscription/entitlement states, mapped to fixtures. Covers the eight the
 * MW-V12-02 prompt names, for every one the product actually models (see
 * src/lib/stripe/plans.ts ENTITLEMENTS): trial-eligible, trial-used, trialing,
 * active, past_due, canceled, sample-used and no-subscription.
 */
export const USER_STATES: UserState[] = [
  {
    id: "no-subscription",
    fixture: "trial-eligible",
    stripeStatus: "none",
    meaning: "No subscription row: sample tier, may start a trial at checkout.",
  },
  {
    id: "trial-eligible",
    fixture: "trial-eligible",
    stripeStatus: "none",
    meaning: "Never trialed: pricing offers a trial CTA with a cancel-by date.",
  },
  {
    id: "trialing",
    fixture: "plan-ready",
    stripeStatus: "trialing",
    meaning: "In-trial premium: full generation, trial banner shown.",
  },
  {
    id: "active",
    fixture: "active",
    stripeStatus: "active",
    meaning: "Converted paid: full generation, NO trial banner.",
  },
  {
    id: "past_due",
    fixture: "past-due",
    stripeStatus: "past_due",
    meaning: "Payment failed: read stays, generation waits, one recovery route.",
  },
  {
    id: "canceled",
    fixture: "canceled",
    stripeStatus: "canceled",
    meaning: "Subscription ended: read stays, plans offered without pressure.",
  },
  {
    id: "trial-used",
    fixture: "trial-used",
    stripeStatus: "canceled",
    meaning: "One lifetime trial spent: pay-today copy, no cancel-by date.",
  },
  {
    id: "sample-used",
    fixture: "sample-used",
    stripeStatus: "none",
    meaning: "Free sample consumed: check-in tells them Premium is needed.",
  },
];

/** How far along a journey's implementation is. */
export type Coverage =
  /** A running test exists in `spec` whose title contains `titleNeedle`. */
  | "covered"
  /** Required by the matrix but not yet authored; needs env/AI/Stripe to run. */
  | "planned";

export type Viewport = "desktop" | "mobile" | "mobile-320";
export const ALL_VIEWPORTS: Viewport[] = ["desktop", "mobile", "mobile-320"];

export interface MatrixJourney {
  /** Stable id, unique within the matrix. */
  id: string;
  /** One-line description of what the journey proves. */
  description: string;
  /** The fixture the journey needs, or "none"/"public" for state-independent. */
  fixture: SeedState | "none" | "public";
  coverage: Coverage;
  /** The spec file the test lives in (or will live in). */
  spec: string;
  /**
   * A substring of the test title. The integrity test asserts a `covered`
   * journey's needle is present in its spec file, so renaming the test without
   * updating the matrix fails the build rather than silently orphaning it.
   */
  titleNeedle?: string;
  viewports: Viewport[];
}

const AUTH = "e2e/journeys.spec.ts";
const DAILY = "e2e/daily-journey.spec.ts";

/**
 * Every required authenticated journey. `covered` rows have a running test;
 * `planned` rows are enumerated honestly and still block a GO because the
 * release runner reports them, but they are not asserted to exist yet.
 */
export const JOURNEYS: MatrixJourney[] = [
  // --- account & session -------------------------------------------------
  {
    id: "login-settings-controls",
    description: "Login, consent state, settings data controls (export + delete).",
    fixture: "plan-ready",
    coverage: "covered",
    spec: AUTH,
    titleNeedle: "settings data controls",
    viewports: ALL_VIEWPORTS,
  },
  {
    id: "sign-out",
    description: "Sign out from the account hub returns to /login.",
    fixture: "plan-ready",
    coverage: "covered",
    spec: AUTH,
    titleNeedle: "sign out ends the session",
    viewports: ["mobile", "desktop"],
  },
  {
    id: "session-expiry",
    description: "An expired session redirects an authenticated route to /login.",
    fixture: "plan-ready",
    coverage: "covered",
    spec: AUTH,
    titleNeedle: "expired session redirects to login",
    viewports: ["desktop"],
  },
  {
    id: "signup-confirmation-callback",
    description: "Signup confirmation / auth callback establishes a session.",
    fixture: "none",
    coverage: "planned",
    spec: AUTH,
    viewports: ["desktop"],
  },
  {
    id: "onboarding",
    description: "First-run onboarding writes a wellbeing profile.",
    fixture: "none",
    coverage: "planned",
    spec: AUTH,
    viewports: ["mobile", "desktop"],
  },
  // --- pricing / trial / checkout ---------------------------------------
  {
    id: "pricing-trial-state",
    description: "Pricing reflects the signed-in user's trial state (never both).",
    fixture: "plan-ready",
    coverage: "covered",
    spec: AUTH,
    titleNeedle: "pricing reflects trial state",
    viewports: ALL_VIEWPORTS,
  },
  {
    id: "trial-length-disclosure",
    description: "Assigned trial length disclosed identically on pricing + billing.",
    fixture: "trial-eligible",
    coverage: "covered",
    spec: AUTH,
    titleNeedle: "disclosed identically on pricing and billing",
    viewports: ["mobile", "desktop"],
  },
  {
    id: "trial-used-pay-today",
    description: "A prior-trial user sees pay-today copy only, no cancel-by date.",
    fixture: "trial-used",
    coverage: "covered",
    spec: AUTH,
    titleNeedle: "already used their trial sees pay-today copy",
    viewports: ["mobile", "desktop"],
  },
  {
    id: "checkout-return-entitlement",
    description: "Checkout return reconciles entitlement from Stripe state.",
    fixture: "none",
    coverage: "planned",
    spec: AUTH,
    viewports: ["desktop"],
  },
  // --- free sample -------------------------------------------------------
  {
    id: "sample-used-gate",
    description: "A sample-consumed user is told Premium is needed to generate.",
    fixture: "sample-used",
    coverage: "covered",
    spec: AUTH,
    titleNeedle: "sample-used check-in points to Premium",
    viewports: ["mobile", "desktop"],
  },
  {
    id: "free-sample-create",
    description: "A no-card sample plan can be created once per account.",
    fixture: "trial-eligible",
    coverage: "planned",
    spec: AUTH,
    viewports: ["mobile", "desktop"],
  },
  // --- daily loop --------------------------------------------------------
  {
    id: "daily-no-plan",
    description: "No plan yet: one entry action, reachable by keyboard.",
    fixture: "no-plan",
    coverage: "covered",
    spec: DAILY,
    titleNeedle: "offers exactly one way forward",
    viewports: ALL_VIEWPORTS,
  },
  {
    id: "daily-plan-ready",
    description: "Plan ready: exactly one Now action; full plan reachable.",
    fixture: "plan-ready",
    coverage: "covered",
    spec: DAILY,
    titleNeedle: "shows one Now action",
    viewports: ALL_VIEWPORTS,
  },
  {
    id: "daily-active",
    description: "Active (paid) user reaches Today with no trial banner.",
    fixture: "active",
    coverage: "covered",
    spec: DAILY,
    titleNeedle: "active subscription reaches Today without a trial banner",
    viewports: ["mobile", "desktop"],
  },
  {
    id: "completed-item-preservation",
    description: "A completed item is skipped by Now but kept in the full plan.",
    fixture: "partly-done",
    coverage: "covered",
    spec: DAILY,
    titleNeedle: "skips the completed item without hiding it",
    viewports: ALL_VIEWPORTS,
  },
  {
    id: "double-tap-idempotent",
    description: "A double tap on Done completes exactly once.",
    fixture: "plan-ready",
    coverage: "covered",
    spec: DAILY,
    titleNeedle: "double tap on Done completes once",
    viewports: ["mobile", "desktop"],
  },
  {
    id: "undo",
    description: "Undo reverses a completion cleanly.",
    fixture: "plan-ready",
    coverage: "covered",
    spec: DAILY,
    titleNeedle: "Undo reverses the completion",
    viewports: ["mobile", "desktop"],
  },
  {
    id: "all-done-neutral",
    description: "All done: neutral 'nothing left', plan still open.",
    fixture: "all-done",
    coverage: "covered",
    spec: DAILY,
    titleNeedle: "states there is nothing left, neutrally",
    viewports: ALL_VIEWPORTS,
  },
  {
    id: "low-capacity-day",
    description: "A make-today-lighter day reduces demand, not adds tasks.",
    fixture: "plan-ready",
    coverage: "planned",
    spec: DAILY,
    viewports: ["mobile", "desktop"],
  },
  {
    id: "adjust-remaining",
    description: "Adjust the rest of today in one pass, with Undo.",
    fixture: "plan-ready",
    coverage: "planned",
    spec: DAILY,
    viewports: ["mobile", "desktop"],
  },
  {
    id: "weekly-carry-forward",
    description: "Weekly reflection carries choices into next week.",
    fixture: "active",
    coverage: "planned",
    spec: DAILY,
    viewports: ["desktop"],
  },
  // --- recovery / edge states -------------------------------------------
  {
    id: "past-due-readable",
    description: "Past due: history readable, one route to billing.",
    fixture: "past-due",
    coverage: "covered",
    spec: DAILY,
    titleNeedle: "says history is readable",
    viewports: ALL_VIEWPORTS,
  },
  {
    id: "canceled-readable",
    description: "Canceled: history readable, plans offered without pressure.",
    fixture: "canceled",
    coverage: "covered",
    spec: DAILY,
    titleNeedle: "keeps history readable and offers plans",
    viewports: ["mobile", "desktop"],
  },
  {
    id: "ending-single-notice",
    description: "Trial set not to renew shows one notice, not two.",
    fixture: "ending",
    coverage: "covered",
    spec: DAILY,
    titleNeedle: "shows one notice, not a trial countdown",
    viewports: ["mobile", "desktop"],
  },
  {
    id: "bad-timezone-repair",
    description: "Invalid stored timezone offers repair, not a wrong day.",
    fixture: "bad-timezone",
    coverage: "covered",
    spec: DAILY,
    titleNeedle: "offers timezone repair",
    viewports: ["mobile", "desktop"],
  },
  {
    id: "provider-error",
    description: "A provider error degrades gracefully, no data loss.",
    fixture: "plan-ready",
    coverage: "planned",
    spec: DAILY,
    viewports: ["desktop"],
  },
];

/** The distinct fixtures a full matrix run must seed at least once. */
export function requiredFixtures(): SeedState[] {
  const seen = new Set<SeedState>();
  for (const j of JOURNEYS) {
    if (j.fixture !== "none" && j.fixture !== "public") seen.add(j.fixture);
  }
  return [...seen];
}

/** Covered journeys grouped by the fixture they need, for the release runner. */
export function coveredByFixture(): Map<SeedState, MatrixJourney[]> {
  const byFixture = new Map<SeedState, MatrixJourney[]>();
  for (const j of JOURNEYS) {
    if (j.coverage !== "covered") continue;
    if (j.fixture === "none" || j.fixture === "public") continue;
    const list = byFixture.get(j.fixture) ?? [];
    list.push(j);
    byFixture.set(j.fixture, list);
  }
  return byFixture;
}
