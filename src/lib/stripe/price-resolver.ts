import "server-only";
import { serverEnv } from "@/lib/env";
import { type Currency, DEFAULT_CURRENCY } from "@/lib/stripe/currency";
import type { Interval } from "@/lib/stripe/plans";

/**
 * Resolve the Stripe price id (and the currency it actually charges in) for an
 * interval + requested presentment currency. EUR is used only when a EUR price
 * id is configured for that interval; otherwise it falls back to USD so a
 * missing EUR price can never break checkout (Scalvya's "never break checkout"
 * rule). The returned `currency` is the one that will really be charged — store
 * and disclose that, not the requested one.
 */
export function resolvePrice(
  interval: Interval,
  requested: Currency
): { priceId: string; currency: Currency } {
  if (requested === "eur") {
    const eurId =
      interval === "monthly"
        ? serverEnv.stripePriceProMonthlyEur
        : serverEnv.stripePriceProYearlyEur;
    if (eurId) return { priceId: eurId, currency: "eur" };
    // No EUR price for this interval — fall back to USD.
  }
  const usdId =
    interval === "monthly"
      ? serverEnv.stripePriceProMonthlyUsd
      : serverEnv.stripePriceProYearlyUsd;
  return { priceId: usdId, currency: DEFAULT_CURRENCY };
}
