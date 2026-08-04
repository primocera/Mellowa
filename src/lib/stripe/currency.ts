/**
 * Region-based presentment currency (ported from Scalvya's EUR pricing work).
 *
 * Mellowa is USD-first (primary market is the US). EU/EEA buyers are charged in
 * EUR so their cards do not fail 3DS on a foreign-currency charge, everyone else
 * pays USD. There is ONE price id per interval carrying a USD amount and an EUR
 * currency_option; checkout passes the resolved currency so Stripe selects the
 * matching amount. There is NO live FX conversion and NO silent USD fallback:
 * when EUR is enabled the EUR currency_option MUST exist (enforced fail-closed
 * by `npm run verify-prices` and the readiness endpoint), so display and charge
 * always agree.
 *
 * The whole EUR path is gated behind EUR_PRICING_ENABLED. With the flag off (the
 * safe default) every buyer sees and pays USD.
 */

export const CURRENCIES = ["usd", "eur"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** USD is primary. Everything falls back here. */
export const DEFAULT_CURRENCY: Currency = "usd";

/** EU + EEA ISO-3166 alpha-2 codes that should be quoted and charged in EUR. */
const EUR_COUNTRIES = new Set<string>([
  // Eurozone
  "AT", "BE", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT",
  "LU", "MT", "NL", "PT", "SK", "SI", "ES", "HR",
  // Non-euro EU (still EU-based cards; EUR avoids a USD 3DS foreign charge)
  "BG", "CZ", "DK", "HU", "PL", "RO", "SE",
  // EEA
  "IS", "LI", "NO",
]);

export function isEurPricingEnabled(): boolean {
  return process.env.EUR_PRICING_ENABLED === "1";
}

/** Normalize a Zod/string currency to a supported one, defaulting to USD. */
export function toCurrency(value: string | null | undefined): Currency {
  const v = (value ?? "").toLowerCase();
  return (CURRENCIES as readonly string[]).includes(v) ? (v as Currency) : DEFAULT_CURRENCY;
}

/**
 * The currency to quote/charge a buyer in the given country. USD unless EUR
 * pricing is enabled AND the country is in the EUR set. An unknown country
 * (no geo header) falls back to USD — the safe, primary-market default.
 */
export function currencyForCountry(country: string | null | undefined): Currency {
  if (!isEurPricingEnabled()) return DEFAULT_CURRENCY;
  const code = (country ?? "").toUpperCase();
  return EUR_COUNTRIES.has(code) ? "eur" : DEFAULT_CURRENCY;
}

/** Vercel sets x-vercel-ip-country on every request from its edge. */
export function countryFromHeaders(
  headers: Headers | { get(name: string): string | null }
): string | null {
  return headers.get("x-vercel-ip-country");
}

/** Resolve the presentment currency for an incoming request. */
export function currencyFromRequest(
  req: Request | { headers: Headers }
): Currency {
  return currencyForCountry(countryFromHeaders(req.headers));
}
