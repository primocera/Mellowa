/** Plan definitions and usage limits for the Mellowa trial-only model. */

export type PlanTier = "sample" | "premium";

export type PremiumFeature =
  | "weekly_plan"
  | "meal_rhythm"
  | "journal_reflection"
  | "progress_insight";

export const TRIAL_DAYS = 3;

export const PLAN_LIMITS = {
  // Not subscribed: a single sample daily plan to preview the product.
  sample: {
    dailyPlansTotal: 1,
    weeklyPlansPerMonth: 0,
    premiumFeatures: [] as PremiumFeature[],
  },
  // Trialing or active: full access.
  premium: {
    dailyPlansTotal: Number.POSITIVE_INFINITY,
    weeklyPlansPerMonth: 60,
    premiumFeatures: [
      "weekly_plan",
      "meal_rhythm",
      "journal_reflection",
      "progress_insight",
    ] as PremiumFeature[],
  },
} as const;

/**
 * Stripe statuses that unlock Premium. Trial and active only.
 * Decision: `past_due` is NOT auto-unlocked — the billing page shows a
 * warning and the user keeps read access, but new premium generations are
 * gated until payment recovers. `canceled`/`incomplete`/`unpaid` are locked.
 */
export const ACTIVE_STATUSES = ["trialing", "active"];

/**
 * Canonical entitlement matrix (Prompt 3, audit v5). Every Stripe status the
 * app can store maps to explicit read/generate access — UI, AI guards,
 * billing page and checkout must all derive from this, never re-derive
 * status logic locally.
 *
 * - read: the user can view their existing data (always true — we never lock
 *   people out of their own wellbeing history).
 * - generate: premium AI generation (daily/weekly plans etc.).
 * - checkout: user may start a (new) checkout from this state.
 */
export type EntitlementStatus =
  | "none"
  | "incomplete"
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled";

export interface Entitlement {
  read: true;
  generate: boolean;
  checkout: boolean;
}

const ENTITLEMENTS: Record<EntitlementStatus, Entitlement> = {
  none: { read: true, generate: false, checkout: true },
  // incomplete = customer row created but checkout never completed (abandoned
  // or payment failed at creation). Allow retrying checkout — the per-user
  // idempotency key prevents duplicate subscriptions.
  incomplete: { read: true, generate: false, checkout: true },
  trialing: { read: true, generate: true, checkout: false },
  active: { read: true, generate: true, checkout: false },
  // past_due keeps read access; new premium generations wait for recovery.
  past_due: { read: true, generate: false, checkout: false },
  unpaid: { read: true, generate: false, checkout: false },
  canceled: { read: true, generate: false, checkout: true },
};

export function entitlementFor(status: string | null | undefined): Entitlement {
  // cancel_at_period_end does not change entitlement — the user stays
  // trialing/active until Stripe transitions the status itself.
  if (status && status in ENTITLEMENTS) {
    return ENTITLEMENTS[status as EntitlementStatus];
  }
  // Unknown/unmapped status: fail closed for generation, allow nothing new.
  return { read: true, generate: false, checkout: false };
}

export const PREMIUM_FEATURES: readonly string[] = [
  "Personalized daily plans, with fair-use safeguards",
  "Weekly reset with meal rhythm & shopping list",
  "Make-today-lighter mode",
  "Journal reflections",
  "Progress insights",
];

export const PRICING = {
  monthly: {
    name: "Mellowa Monthly",
    price: "€9.99",
    cadence: "/month",
    trialDays: TRIAL_DAYS,
    priceEnvVar: "STRIPE_PRICE_PRO_MONTHLY",
    features: PREMIUM_FEATURES,
  },
  yearly: {
    name: "Mellowa Yearly",
    price: "€59.99",
    cadence: "/year",
    trialDays: TRIAL_DAYS,
    priceEnvVar: "STRIPE_PRICE_PRO_YEARLY",
    note: "Save 50% compared to monthly",
    features: PREMIUM_FEATURES,
  },
} as const;
