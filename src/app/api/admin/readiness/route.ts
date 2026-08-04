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
  // MW-05: checkout charges EUR with NO USD fallback, so enabling EUR without
  // verified EUR currency_options would mischarge EU buyers. This public
  // endpoint cannot reach Stripe, so it fails closed: when EUR is ON it is only
  // "ready" once the owner has run `npm run verify-prices` against production
  // and set EUR_PRICING_VERIFIED=1. When EUR is OFF this marker is irrelevant.
  const eurVerified = process.env.EUR_PRICING_VERIFIED === "1";
  const eurReady = !eurEnabled || eurVerified;
  const ok = configured && eurReady;

  const body = {
    ok,
    pricing: {
      model: "one price id per interval, USD + EUR currency_options",
      defaultCurrency: DEFAULT_CURRENCY,
      currencies: CURRENCIES,
      eurPricingEnabled: eurEnabled,
      // Whether the owner has attested EUR currency_options were verified on
      // live Stripe. Meaningful only while eurPricingEnabled is true.
      eurPricingVerified: eurVerified,
      catalog: {
        usd: { monthly: CATALOG.usd.monthly.display, yearly: CATALOG.usd.yearly.display },
        eur: { monthly: CATALOG.eur.monthly.display, yearly: CATALOG.eur.yearly.display },
      },
      contract: BILLING_CONTRACT,
      note: eurEnabled
        ? eurVerified
          ? "EUR pricing is ON and verified — EU buyers are charged EUR from the price's EUR currency_option."
          : "NOT READY: EUR pricing is ON but not verified. Run `npm run verify-prices` against production and set EUR_PRICING_VERIFIED=1. Checkout charges EUR with no USD fallback, so unverified EUR options would mischarge EU buyers."
        : "EUR pricing is OFF — every buyer sees and pays USD.",
    },
    priceEnvVarsConfigured: prices,
    note: "Public config view (no secrets, no price ids). Run `npm run verify-prices` to compare the live Stripe amounts (incl. EUR currency_options) against BILLING_CONTRACT.",
  };

  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
