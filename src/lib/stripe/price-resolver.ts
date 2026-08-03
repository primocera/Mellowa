import "server-only";
import { serverEnv } from "@/lib/env";
import type { Currency } from "@/lib/stripe/currency";
import type { Interval } from "@/lib/stripe/plans";

export type PlanName = "pro_monthly" | "pro_yearly";

/**
 * Map a Stripe price id back to the plan it represents. There is ONE price id
 * per interval (each carrying USD + EUR amounts as currency_options), so this is
 * a straight id match. Returns null for a genuinely foreign price (another
 * product), which the caller treats as a configuration error.
 */
export function planFromPriceId(priceId: string | null | undefined): PlanName | null {
  if (!priceId) return null;
  if (priceId === serverEnv.stripePriceProMonthly) return "pro_monthly";
  if (priceId === serverEnv.stripePriceProYearly) return "pro_yearly";
  return null;
}

/**
 * Resolve the Stripe price id for an interval and the currency to charge in.
 * The id is the same regardless of currency — the currency is passed to the
 * Checkout Session so Stripe selects the matching currency_option on that price.
 * `requested` is already USD unless EUR pricing is enabled AND the buyer is in
 * the EUR region (see currencyFromRequest), so the owner must attach a EUR
 * currency_option to BOTH prices before enabling EUR_PRICING_ENABLED.
 */
export function resolvePrice(
  interval: Interval,
  requested: Currency
): { priceId: string; currency: Currency } {
  const priceId =
    interval === "monthly"
      ? serverEnv.stripePriceProMonthly
      : serverEnv.stripePriceProYearly;
  return { priceId, currency: requested };
}
