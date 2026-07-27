/** Plan definitions and usage limits for the Mellowa trial-only model. */

export type PlanTier = "sample" | "premium";

export type PremiumFeature =
  | "weekly_plan"
  | "meal_rhythm"
  | "journal_reflection"
  | "progress_insight";

export const PLAN_LIMITS = {
  // Not subscribed: a single sample daily plan to preview the product.
  sample: {
    dailyPlansTotal: 1,
    weeklyPlansPerMonth: 0,
    // MW-S07: one lifetime curated (non-AI) section swap — movement, calm
    // reset or evening — so the sample shows adaptation, not just generation.
    sampleAdjustmentsTotal: 1,
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

/**
 * MW-S09: Premium is packaged around three real jobs — adapt today, reuse
 * what works, carry decisions into next week. Only implemented capabilities
 * are named; no outcome claims (calm, health, adherence, productivity) and
 * never "unlimited".
 */
export const PREMIUM_FEATURES: readonly string[] = [
  // Adapt today
  "Ongoing daily plans, with fair-use safeguards",
  "Adjust the rest of today in one pass, with free Undo",
  "Make-today-lighter mode",
  // Reuse what works
  "Preference learning you can see, edit and remove",
  "Saved meals, leftovers and shopping drafts that reuse what you liked",
  // Carry into next week
  "Weekly plans with a reflection that carries your choices forward",
  "Journal reflections",
  "Progress insights",
];

/**
 * MW-V10-02: PRICING deliberately carries no trial length. The length is
 * per-user (server-assigned, then pinned at checkout), so every surface reads it
 * from lib/stripe/trial-experiment instead. A constant here would be the easiest
 * way to show a 7-day cohort 3-day copy.
 */
export const PRICING = {
  monthly: {
    name: "Mellowa Monthly",
    price: "€9.99",
    cadence: "/month",
    priceEnvVar: "STRIPE_PRICE_PRO_MONTHLY",
    features: PREMIUM_FEATURES,
  },
  yearly: {
    name: "Mellowa Yearly",
    price: "€59.99",
    cadence: "/year",
    priceEnvVar: "STRIPE_PRICE_PRO_YEARLY",
    note: "Save 50% compared to monthly",
    features: PREMIUM_FEATURES,
  },
} as const;

/**
 * What the Stripe price objects MUST be, in machine-comparable form.
 *
 * Why this exists: the live prices were created in **USD** while every surface
 * in the product — landing, pricing, paywall, emails, Terms, Refund policy —
 * promised EUR. A user reading "€9.99" was sent to a checkout charging $9.99,
 * their bank converted at its own rate and added a foreign-transaction fee, so
 * the amount actually taken was never a number this product had shown them.
 * `release-check` passed throughout, because it verified only that the price
 * IDs were *set* — never what they cost or in what currency.
 *
 * `scripts/verify-stripe-prices.mjs` compares these values against the real
 * Stripe objects. The display strings above and the amounts here are pinned to
 * each other by `tests/billing-contract.test.ts`, so changing a price has to be
 * done deliberately in both places rather than drifting in one.
 */
export const BILLING_CONTRACT = {
  currency: "eur",
  monthly: { minorUnits: 999, interval: "month", envVar: "STRIPE_PRICE_PRO_MONTHLY" },
  yearly: { minorUnits: 5999, interval: "year", envVar: "STRIPE_PRICE_PRO_YEARLY" },
} as const;
