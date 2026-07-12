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

export const PREMIUM_FEATURES: readonly string[] = [
  "Unlimited personalized daily plans",
  "Weekly reset with meal rhythm & shopping list",
  "Low-energy day mode",
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
