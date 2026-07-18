/**
 * System microcopy map (Content Elevation v6, Prompt 15).
 *
 * One source of truth for customer-facing error, loading and success copy.
 * Raw Supabase / Stripe / AI-provider / database messages must never reach a
 * customer — routes and components map to a `PublicErrorCode` and render the
 * copy here. Every recoverable error follows one formula:
 *   what happened → what was preserved → one next action.
 */

export type PublicErrorCode =
  | "generic"
  | "plan_provider_failure"
  | "capacity"
  | "rate_limit"
  | "offline"
  | "save_failed"
  | "session_expired"
  | "onboarding_required"
  | "allergen_validation"
  | "delete_blocked"
  | "email_resend"
  | "empty_list";

/**
 * Canonical copy per state. `{time}` is substituted with an approximate,
 * human wait ("about 10 minutes") when the caller knows one; otherwise the
 * fallback keeps the sentence truthful without inventing a number.
 */
const COPY: Record<PublicErrorCode, string> = {
  generic: "That didn't go through. Your changes are still here—try once more.",
  plan_provider_failure:
    "Mellowa couldn't shape a new plan just now. Your check-in is saved. Try again in a few minutes.",
  capacity:
    "Plan creation is busy right now. Your check-in is safe. Try again in {time}.",
  rate_limit:
    "You've created several new versions today. Try again {time}, or reuse your latest plan.",
  offline:
    "You're offline. Reconnect to create a new plan. Saved plans remain available.",
  save_failed: "This change wasn't saved. Try once more.",
  session_expired:
    "Your session ended. Sign in again—anything saved before this point is still there.",
  onboarding_required:
    "Finish the short setup before creating a plan. Your check-in draft will stay here.",
  allergen_validation:
    "We couldn't create meals we're confident avoid your listed allergies, so we stopped before showing them. Try again and always check product labels.",
  delete_blocked:
    "We couldn't cancel billing automatically, so nothing was deleted. Manage billing first or contact support.",
  email_resend:
    "A new confirmation link is on its way. You can request another in 60 seconds.",
  empty_list: "Nothing here yet. Add only what you expect to use again.",
};

/**
 * Resolve a public error code to display copy. `time` is an already-formatted,
 * approximate phrase (e.g. "about 10 minutes", "after 3pm"); when omitted the
 * sentence falls back to "shortly" / "in a little while" so no fake precision
 * is shown.
 */
export function errorCopy(
  code: PublicErrorCode,
  opts: { time?: string } = {}
): string {
  const template = COPY[code];
  if (!template.includes("{time}")) return template;
  const time = opts.time?.trim();
  // Keep each fallback grammatical for its own sentence:
  //   capacity   → "Try again in {time}."
  //   rate_limit → "Try again {time}, or reuse…"
  const fallback = code === "rate_limit" ? "in a little while" : "a few minutes";
  return template.replaceAll("{time}", time || fallback);
}

/** Loading (present-progressive) and success language, never a fake percentage. */
export const LOADING_COPY = {
  daily_plan: "Matching the plan to your time and energy…",
  lighter_day: "Making the day simpler…",
  weekly_plan: "Shaping the week around what you shared…",
  meal_swap: "Finding another option…",
  shopping_list: "Grouping the items you chose…",
  preferences: "Saving changes…",
  export: "Preparing your data…",
} as const;

export const SUCCESS_COPY = {
  daily_plan: "Today's plan is ready.",
  lighter_day: "Here is the lightest useful version.",
  weekly_plan: "Your week has a starting shape.",
  meal_swap: "Meal updated.",
  shopping_list: "Shopping list ready to edit.",
  preferences: "Future plans will use these preferences.",
  export: "Your download is ready.",
} as const;
