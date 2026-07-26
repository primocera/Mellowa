/**
 * Canonical customer-facing terminology (Content Elevation v6, Prompt 1).
 * Pure module — safe for client, server and tests.
 *
 * Only repeated product names and promise lines live here; screens keep
 * their own sentences. See docs/content-system.md for the full system.
 */

export const TERMS = {
  /** Primary promise — hero and canonical descriptions. */
  promise: "A realistic wellbeing plan for the day you actually have.",
  /** Differentiation line. */
  difference: "No calorie targets. No streak pressure. No starting over.",
  /**
   * Free sample CTA + helper (funnel truth, Launch v6 Prompt 2).
   * MW-V10-02: the helper no longer names a trial length. The length depends on
   * the viewer's server-assigned cohort, so surfaces append
   * `trialOfferSentence(days)` from lib/stripe/trial-experiment instead of
   * hardcoding a number here.
   */
  sampleCta: "Create my free sample plan",
  /**
   * The above-the-fold sample disclosure, stated exactly once.
   *
   * MW-V11-01: the hero previously rendered this line and then immediately
   * repeated the same fact in different words ("An account is required; no card
   * is requested for the sample"), which reads as an unfinished page. Both
   * facts a visitor needs before clicking — an account, and no card — are here
   * in one sentence, so no adjacent component has to restate either.
   */
  sampleHelper:
    "An account is required for the free sample, and no payment card is requested for it.",
  /** Hub display names (internal routes/fields unchanged). */
  hubs: {
    today: "Today",
    week: "Week",
    library: "Library",
    patterns: "Patterns",
    you: "You",
    resets: "Resets",
  },
  /** Reduced-capacity flow (replaces "tiny plan" language). */
  lighter: {
    action: "Make today lighter",
    easiest: "Easiest version",
  },
} as const;

/**
 * Join sentences with exactly one space, as a single string.
 *
 * Why this exists rather than writing `{a} {b}` in JSX: the live hero rendered
 * "…the day you actually have.Tell Mellowa…" with no space at all. JSX strips
 * the whitespace between an expression and an adjacent text node when that text
 * node spans lines, so the space disappeared the moment the paragraph was
 * wrapped — invisible in the source, wrong in the browser, and impossible to
 * catch by reading the JSX.
 *
 * Composing the sentence in JavaScript makes it one text node, so the spacing
 * survives reformatting, prettier, translation and any future re-wrap. Empty
 * and whitespace-only parts are dropped, so an unknown-length disclosure that
 * returns nothing cannot leave a double space behind.
 */
export function joinSentences(...parts: (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
}

/**
 * Phrases that must never appear in customer-facing copy (see
 * docs/content-system.md). Checked by tests/content-system.test.ts.
 * Case-insensitive.
 */
export const BANNED_CUSTOMER_PHRASES: readonly string[] = [
  "unlimited",
  "tiny plan",
  "tiny habit",
  "guilt-free",
  "clean eating",
  "cheat day",
  "cheat meal",
  "no excuses",
  "stay on track",
  "fall off the wagon",
  "burn calories",
  "fix your body",
  "perfect day",
  "guaranteed results",
  "cure",
  "diagnose",
  "your therapist",
];
