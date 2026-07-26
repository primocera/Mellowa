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
  sampleHelper: "No card for the sample.",
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
