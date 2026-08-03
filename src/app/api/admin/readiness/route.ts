import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";
import { CATALOG, BILLING_CONTRACT } from "@/lib/stripe/plans";
import { CURRENCIES, DEFAULT_CURRENCY, isEurPricingEnabled } from "@/lib/stripe/currency";

/**
 * Pricing readiness (Scalvya-style /api/admin/readiness). A single JSON view of
 * how the dual-currency (USD-primary, EUR region) pricing is wired, so the owner
 * can confirm at a glance that USD is the default, EUR is gated, and each price
 * env var is present — WITHOUT leaking any secret value (only booleans + a
 * masked id suffix). It never calls Stripe; for the real amount check run
 * `npm run verify-prices`, which compares the live objects to BILLING_CONTRACT.
 *
 * Bearer-protected by ADMIN_STATS_SECRET:
 *   curl -H "Authorization: Bearer $ADMIN_STATS_SECRET" /api/admin/readiness
 */
export async function GET(request: Request) {
  const denied = requireBearerSecret(request, serverEnv.adminStatsSecret);
  if (denied) return denied;

  // Presence only — never the id itself beyond a short, non-identifying suffix.
  const present = (v: string | null | undefined) =>
    v ? { set: true, endsWith: v.slice(-4) } : { set: false };

  // One price id per interval, each carrying USD + EUR currency_options.
  const prices = {
    monthly: present(process.env.STRIPE_PRICE_PRO_MONTHLY),
    yearly: present(process.env.STRIPE_PRICE_PRO_YEARLY),
  };

  const usdReady = prices.monthly.set && prices.yearly.set;
  const eurEnabled = isEurPricingEnabled();

  const body = {
    ok: usdReady,
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
    priceEnvVars: prices,
    stripeConfig: {
      secretKey: process.env.STRIPE_SECRET_KEY ? "set" : "missing",
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ? "set" : "missing",
    },
    note: "Presence + config only. Run `npm run verify-prices` to compare the live Stripe amounts (incl. EUR currency_options) against BILLING_CONTRACT.",
  };

  return NextResponse.json(body, { status: usdReady ? 200 : 503 });
}
