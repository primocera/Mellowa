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

  const prices = {
    usd: {
      monthly: present(serverEnv.stripePriceProMonthlyUsd),
      yearly: present(serverEnv.stripePriceProYearlyUsd),
    },
    eur: {
      monthly: present(serverEnv.stripePriceProMonthlyEur),
      yearly: present(serverEnv.stripePriceProYearlyEur),
    },
  };

  // USD is required; EUR is optional (checkout falls back to USD when absent).
  const usdReady = prices.usd.monthly.set && prices.usd.yearly.set;
  const eurEnabled = isEurPricingEnabled();
  const eurMonthlyReady = prices.eur.monthly.set;

  const body = {
    ok: usdReady,
    pricing: {
      defaultCurrency: DEFAULT_CURRENCY,
      currencies: CURRENCIES,
      eurPricingEnabled: eurEnabled,
      // When the EUR flag is on but no EUR monthly price is configured, EU
      // buyers silently fall back to USD — surface that as a warning.
      eurFallsBackToUsd: eurEnabled && !eurMonthlyReady,
      catalog: {
        usd: {
          monthly: CATALOG.usd.monthly.display,
          yearly: CATALOG.usd.yearly.display,
        },
        eur: {
          monthly: CATALOG.eur.monthly.display,
          yearly: CATALOG.eur.yearly.display, // null — EUR yearly not offered yet
        },
      },
      contract: BILLING_CONTRACT,
    },
    priceEnvVars: prices,
    stripeConfig: {
      secretKey: process.env.STRIPE_SECRET_KEY ? "set" : "missing",
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ? "set" : "missing",
    },
    note: "Presence + config only. Run `npm run verify-prices` to compare the live Stripe amounts against BILLING_CONTRACT.",
  };

  return NextResponse.json(body, { status: usdReady ? 200 : 503 });
}
