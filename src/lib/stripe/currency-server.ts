import "server-only";
import { headers } from "next/headers";
import { currencyForCountry, type Currency } from "@/lib/stripe/currency";

/**
 * Presentment currency for a server-rendered page, from the Vercel edge geo
 * header. USD unless EUR pricing is enabled and the visitor is in the EUR set.
 */
export async function serverCurrency(): Promise<Currency> {
  const h = await headers();
  return currencyForCountry(h.get("x-vercel-ip-country"));
}
