/**
 * MW-V10-03: one clear recovery route for a billing state the user cannot fix
 * by using the app.
 *
 * The failure this closes: a `past_due`, `unpaid` or `canceled` user previously
 * had no signal at all on the authenticated surfaces. They discovered the state
 * only when a generation returned 402 — at the moment they were trying to use
 * the product, in an error message. Their own history was always readable (the
 * entitlement matrix has `read: true` for every status), but nothing said so.
 *
 * Rules encoded here:
 * - Every message states what still works before what does not. Read access is
 *   never in question, so it is never framed as at risk.
 * - Exactly one action, always to /billing. No second CTA competing with it.
 * - No urgency, countdowns, loss framing or wellbeing language. A payment
 *   problem is an admin task, not a judgement about the user.
 * - Pure module so the copy is contract-testable without rendering.
 */

export type RecoveryState = "past_due" | "unpaid" | "canceled" | "ending" | null;

export interface RecoveryNotice {
  state: Exclude<RecoveryState, null>;
  /** Sentence one: what is still available. */
  kept: string;
  /** Sentence two: what needs an action, factually. */
  action: string;
  /** The single CTA label. */
  cta: string;
  href: "/billing";
  /** "attention" gets the warning tone; "info" stays calm. */
  tone: "attention" | "info";
}

/**
 * Decide which recovery notice a user's subscription state needs, if any.
 *
 * `cancelAtPeriodEnd` deliberately produces an *info* notice rather than a
 * warning: nothing is broken, the user made a choice, and the only thing they
 * might want is the reactivation route. Trialing/active users with no pending
 * cancellation get nothing — the trial banner already covers the trial.
 */
export function recoveryNoticeFor(args: {
  status: string;
  cancelAtPeriodEnd?: boolean;
  /** Already-formatted date, e.g. "2 August 2026". Omitted when unknown. */
  periodEndLabel?: string | null;
}): RecoveryNotice | null {
  const { status, cancelAtPeriodEnd, periodEndLabel } = args;

  if (status === "past_due" || status === "unpaid") {
    return {
      state: status,
      kept: "Everything you've already created stays readable.",
      action:
        "The last payment didn't go through, so new plans and adjustments are paused until it's updated.",
      cta: "Update payment method",
      href: "/billing",
      tone: "attention",
    };
  }

  if (status === "canceled") {
    return {
      state: "canceled",
      kept: "Your plans, saved meals and reflections stay readable.",
      action:
        "Your subscription has ended, so new plans and adjustments aren't available right now.",
      cta: "See plans",
      href: "/billing",
      tone: "info",
    };
  }

  if (cancelAtPeriodEnd && (status === "trialing" || status === "active")) {
    return {
      state: "ending",
      kept: periodEndLabel
        ? `You have full access until ${periodEndLabel}, and your history stays readable after that.`
        : "You have full access until the end of your current period, and your history stays readable after that.",
      action: "This subscription is set not to renew.",
      cta: "Keep my subscription",
      href: "/billing",
      tone: "info",
    };
  }

  return null;
}
