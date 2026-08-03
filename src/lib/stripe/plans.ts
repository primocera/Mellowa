/** Plan definitions and usage limits for the Mellowa trial-only model. */

import { type Currency, DEFAULT_CURRENCY } from "@/lib/stripe/currency";

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
/**
 * MW-V12-06: the recurring-value contract. Each Premium capability is paired
 * with the user PROBLEM it solves and the loop phase it belongs to, so the
 * paywall can connect a paid feature to a reason to want it rather than listing
 * an abstract feature. The free sample proves one realistic day; Premium
 * continues the loop across changing days and weeks — that difference is what
 * `problem` makes explicit.
 *
 * Boundaries this list must keep (asserted in tests/premium-value-contract.test.ts):
 * only implemented capabilities; no outcome claims (calm, health, adherence,
 * productivity), no "AI knows you", no therapy, no streaks or calorie targets,
 * never "unlimited".
 */
export const PREMIUM_VALUE = [
  {
    phase: "adapt today",
    capability: "Ongoing daily plans, with fair-use safeguards",
    problem: "The sample is one day. Some days you want a fresh plan, not last week's.",
  },
  {
    phase: "adapt today",
    capability: "Adjust the rest of today in one pass, with free Undo",
    problem: "When the day changes, reshape what's left without starting over.",
  },
  {
    phase: "adapt today",
    capability: "Make-today-lighter mode",
    problem: "On a low-capacity day, get less to do — not another task.",
  },
  {
    phase: "reuse what works",
    capability: "Preference learning you can see, edit and remove",
    problem: "The plan reuses what fit before, and you stay in control of what it learned.",
  },
  {
    phase: "reuse what works",
    capability: "Saved meals, leftovers and shopping drafts that reuse what you liked",
    problem: "Stop re-deciding meals you already know work, and use up what you have.",
  },
  {
    phase: "carry into next week",
    capability: "Weekly plans with a reflection that carries your choices forward",
    problem: "Next week starts from what worked this week, not from scratch.",
  },
  {
    phase: "carry into next week",
    capability: "Journal reflections",
    problem: "A gentle place to notice what helped, without it becoming homework.",
  },
  {
    phase: "carry into next week",
    capability: "Progress insights",
    problem: "See how your days are going over time — described, never scored.",
  },
] as const;

/** The rendered capability strings — derived, so the two can never drift. */
export const PREMIUM_FEATURES: readonly string[] = PREMIUM_VALUE.map(
  (v) => v.capability
);

/** The user problem a Premium capability solves, for the paywall. */
export function premiumProblemFor(capability: string): string | null {
  return PREMIUM_VALUE.find((v) => v.capability === capability)?.problem ?? null;
}

/**
 * Dual-currency catalog (Scalvya-style region pricing). Mellowa is USD-first;
 * EU/EEA buyers are charged in EUR. There is ONE Stripe price id per interval,
 * each carrying a USD and a EUR amount as Stripe `currency_options` — checkout
 * passes the buyer's currency on that same id. Each amount is fixed (no live FX
 * conversion), so the display string and the charged amount are the same
 * authored number. `scripts/verify-stripe-prices.mjs` checks each amount against
 * the real Stripe price's currency_options, and `tests/billing-contract.test.ts`
 * pins the display strings to the minor units.
 *
 * NOTE: both the monthly and yearly EUR amounts are authored below and must be
 * attached as `currency_options` on the matching Stripe prices before
 * EUR_PRICING_ENABLED is turned on. `npm run verify-prices` fails closed if a
 * EUR amount named here is missing on Stripe (see MW-05).
 */
export const CATALOG = {
  usd: {
    symbol: "$",
    monthly: { minorUnits: 1299, display: "$12.99", interval: "month", envVar: "STRIPE_PRICE_PRO_MONTHLY" },
    yearly: { minorUnits: 12999, display: "$129.99", interval: "year", envVar: "STRIPE_PRICE_PRO_YEARLY" },
  },
  eur: {
    symbol: "€",
    // EUR amounts are currency_options on the same monthly/yearly prices.
    // Confirm against Stripe with `npm run verify-prices` before enabling EUR.
    monthly: { minorUnits: 1199, display: "€11.99", interval: "month", envVar: "STRIPE_PRICE_PRO_MONTHLY" },
    yearly: { minorUnits: 11999, display: "€119.99", interval: "year", envVar: "STRIPE_PRICE_PRO_YEARLY" },
  },
} as const;

export type Interval = "monthly" | "yearly";

/** The display price string for a currency+interval (USD fallback). */
export function priceDisplay(currency: Currency, interval: Interval): string {
  return CATALOG[currency][interval].display ?? CATALOG[DEFAULT_CURRENCY][interval].display!;
}

/**
 * Format catalog minor units as a display string in that currency, e.g.
 * (usd, 1299) -> "$12.99". Decimal-safe: the amount is an integer number of
 * minor units and `toFixed(2)` only divides by 100, so no binary-float money
 * math and no rounding of the authored price ever happens here.
 */
export function formatMinorUnits(currency: Currency, minorUnits: number): string {
  return `${CATALOG[currency].symbol}${(minorUnits / 100).toFixed(2)}`;
}

/**
 * Every yearly-vs-monthly number a surface might show, derived from the ONE
 * catalog per currency. All arithmetic is on integer minor units; only the
 * final display strings divide by 100. Nothing here reads a localized display
 * string back into a number, and the percentage is derived — never a hardcoded
 * "Save 50%" (the real saving at current amounts is ~16.6%).
 */
export interface PlanSavings {
  currency: Currency;
  monthlyMinor: number;
  yearlyMinor: number;
  /** yearly price spread across 12 months (rounded to whole minor units). */
  yearlyMonthlyEquivMinor: number;
  /** what 12 monthly charges would cost. */
  twelveMonthTotalMinor: number;
  /** twelveMonthTotal - yearly, i.e. the actual saving. */
  absoluteSavingMinor: number;
  /** absoluteSaving / twelveMonthTotal, rounded to a whole percent. */
  percentSaving: number;
  monthlyDisplay: string;
  yearlyDisplay: string;
  monthlyEquivDisplay: string;
  twelveMonthTotalDisplay: string;
  absoluteSavingDisplay: string;
}

export function planSavings(currency: Currency = DEFAULT_CURRENCY): PlanSavings {
  const monthlyMinor = CATALOG[currency].monthly.minorUnits;
  const yearlyMinor = CATALOG[currency].yearly.minorUnits;
  const twelveMonthTotalMinor = monthlyMinor * 12;
  const absoluteSavingMinor = twelveMonthTotalMinor - yearlyMinor;
  const yearlyMonthlyEquivMinor = Math.round(yearlyMinor / 12);
  const percentSaving =
    twelveMonthTotalMinor > 0
      ? Math.round((absoluteSavingMinor / twelveMonthTotalMinor) * 100)
      : 0;
  return {
    currency,
    monthlyMinor,
    yearlyMinor,
    yearlyMonthlyEquivMinor,
    twelveMonthTotalMinor,
    absoluteSavingMinor,
    percentSaving,
    monthlyDisplay: formatMinorUnits(currency, monthlyMinor),
    yearlyDisplay: formatMinorUnits(currency, yearlyMinor),
    monthlyEquivDisplay: formatMinorUnits(currency, yearlyMonthlyEquivMinor),
    twelveMonthTotalDisplay: formatMinorUnits(currency, twelveMonthTotalMinor),
    absoluteSavingDisplay: formatMinorUnits(currency, absoluteSavingMinor),
  };
}

/**
 * Ready-to-render yearly savings copy for a single currency. Every string is
 * one currency throughout — a USD viewer never sees a euro figure and vice
 * versa — because it all comes from `planSavings(currency)`.
 */
export function savingsCopy(currency: Currency = DEFAULT_CURRENCY) {
  const s = planSavings(currency);
  return {
    /** short badge, e.g. "Save $25.89". */
    badge: `Save ${s.absoluteSavingDisplay}`,
    /** e.g. "About $10.83/month". */
    monthlyEquivShort: `About ${s.monthlyEquivDisplay}/month`,
    /** full, checkable monthly-equivalent note. */
    monthlyEquivNote: `About ${s.monthlyEquivDisplay}/month, billed yearly — ${s.yearlyDisplay} instead of ${s.twelveMonthTotalDisplay} (12 × ${s.monthlyDisplay}).`,
    /** full, checkable one-line arithmetic. */
    arithmetic: `${s.yearlyDisplay}/year instead of ${s.twelveMonthTotalDisplay} (12 × ${s.monthlyDisplay}) — you save ${s.absoluteSavingDisplay}.`,
    savings: s,
  } as const;
}

/**
 * PRICING shaped per currency, for a pricing/paywall surface. USD is the
 * default so existing (region-unaware) callers keep working unchanged.
 */
export function pricingFor(currency: Currency = DEFAULT_CURRENCY) {
  return {
    currency,
    monthly: {
      name: "Mellowa Monthly",
      price: priceDisplay(currency, "monthly"),
      cadence: "/month",
      features: PREMIUM_FEATURES,
    },
    yearly: {
      name: "Mellowa Yearly",
      price: priceDisplay(currency, "yearly"),
      cadence: "/year",
      // Derived from the catalog, never a hardcoded percent. At current amounts
      // the real saving is ~16.6%, so "Save 50%" would be false.
      note: savingsCopy(currency).badge,
      features: PREMIUM_FEATURES,
    },
  } as const;
}

/** Back-compat default (USD) export for surfaces that do not resolve a region. */
export const PRICING = pricingFor(DEFAULT_CURRENCY);

/**
 * What the Stripe price objects MUST be, in machine-comparable form, per
 * currency. `verify-stripe-prices.mjs` compares these against the live objects.
 * A `minorUnits: null` entry means that currency+interval price is not offered
 * (no Stripe object expected).
 */
export const BILLING_CONTRACT = {
  defaultCurrency: DEFAULT_CURRENCY,
  usd: {
    monthly: { minorUnits: 1299, interval: "month", envVar: "STRIPE_PRICE_PRO_MONTHLY" },
    yearly: { minorUnits: 12999, interval: "year", envVar: "STRIPE_PRICE_PRO_YEARLY" },
  },
  eur: {
    monthly: { minorUnits: 1199, interval: "month", envVar: "STRIPE_PRICE_PRO_MONTHLY" },
    yearly: { minorUnits: 11999, interval: "year", envVar: "STRIPE_PRICE_PRO_YEARLY" },
  },
} as const;
