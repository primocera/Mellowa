import { NextResponse } from "next/server";
import { CATALOG, BILLING_CONTRACT } from "@/lib/stripe/plans";
import { CURRENCIES, DEFAULT_CURRENCY, isEurPricingEnabled } from "@/lib/stripe/currency";

/**
 * Pricing readiness (Scalvya-style). A single JSON view of how the dual-currency
 * (USD-primary, EUR region) pricing is wired, so anyone can eyeball it in a
 * browser. PUBLIC and safe by construction: it exposes only what is already
 * public (the displayed prices + the currency model + whether the price env
 * vars are configured as a boolean). It reveals NO secret, NO price id, and
 * never touches STRIPE_SECRET_KEY / webhook secrets. For the authoritative
 * amount check against live Stripe (incl. EUR currency_options), run
 * `npm run verify-prices`.
 */
export async function GET() {
  // Booleans only — never the id, so this is safe to expose publicly.
  const prices = {
    monthly: Boolean(process.env.STRIPE_PRICE_PRO_MONTHLY),
    yearly: Boolean(process.env.STRIPE_PRICE_PRO_YEARLY),
  };

  const configured = prices.monthly && prices.yearly;
  const eurEnabled = isEurPricingEnabled();

  const body = {
    ok: configured,
    pricing: {
      model: "one price id per interval, USD + EUR currency_options",
      defaultCurrency: DEFAULT_CURRENCY,
      currencies: CURRENCIES,
      eurPricingEnabled: eurEnabled,
      catalog: {
        usd: { monthly: CATALOG.usd.monthly.display, yearly: CATALOG.usd.yearly.display },
        eur: { monthly: CATALOG.eur.monthly.display, yearly: CATALOG.eur.yearly.display },
      },
      contract: BILLING_CONTRACT,
      note: eurEnabled
        ? "EUR pricing is ON — the monthly and yearly prices must each have a EUR currency_option (verify with `npm run verify-prices`), or EU buyers fall back to USD."
        : "EUR pricing is OFF — every buyer pays USD.",
    },
    priceEnvVarsConfigured: prices,
    note: "Public config view (no secrets, no price ids). Run `npm run verify-prices` to compare the live Stripe amounts (incl. EUR currency_options) against BILLING_CONTRACT.",
  };

  return NextResponse.json(body, { status: configured ? 200 : 503 });
}
