/**
 * Email category registry (Launch v6, Prompt 19).
 *
 * Every template name that can reach deliverEmail must be classified here.
 * - `transactional`: account/billing/security truth the user must receive;
 *   cannot be opted out of (verify, trial charges, cancellation, payment
 *   state, deletion confirmation).
 * - `optional`: product nudges the user controls. Daily reminders are gated
 *   by `wellbeing_profiles.reminders_opt_in` (+ reminder time, quiet-hour
 *   scheduling in the planner); the onboarding nudge is strictly one-time
 *   (ledger event key) and suppressed as soon as a profile exists.
 *
 * Eligibility for every message comes from server state (auth, subscriptions,
 * profiles, delivery ledger) — never from mood, journal, meal or check-in
 * content, which must not appear in subjects, bodies or provider metadata.
 */
export const EMAIL_CATEGORIES = {
  verify: "transactional",
  welcome: "transactional",
  sample_ready: "transactional",
  trial_started: "transactional",
  trial_ending: "transactional",
  trial_ended: "transactional",
  canceled: "transactional",
  payment_failed: "transactional",
  payment_recovered: "transactional",
  account_deleted: "transactional",
  daily_reminder: "optional",
  onboarding_nudge: "optional",
} as const satisfies Record<string, "transactional" | "optional">;

export type EmailTemplateName = keyof typeof EMAIL_CATEGORIES;

export function isOptionalEmail(template: string): boolean {
  return (
    EMAIL_CATEGORIES[template as EmailTemplateName] === "optional"
  );
}
