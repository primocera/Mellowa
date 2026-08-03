import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currencyForCountry,
  currencyFromRequest,
  toCurrency,
  DEFAULT_CURRENCY,
} from "@/lib/stripe/currency";

/**
 * Region-based presentment currency: USD is primary; EU/EEA buyers get EUR only
 * when EUR_PRICING_ENABLED=1. Unknown/absent geo always falls back to USD — the
 * safe, primary-market default — so a missing geo header never mis-charges.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("currencyForCountry", () => {
  it("is USD for everyone when EUR pricing is disabled", () => {
    vi.stubEnv("EUR_PRICING_ENABLED", "");
    expect(currencyForCountry("DE")).toBe("usd");
    expect(currencyForCountry("US")).toBe("usd");
  });

  it("charges EU/EEA buyers in EUR when enabled", () => {
    vi.stubEnv("EUR_PRICING_ENABLED", "1");
    for (const c of ["DE", "FR", "IE", "NL", "PL", "SE", "NO", "IS"]) {
      expect(currencyForCountry(c), `${c} should be EUR`).toBe("eur");
    }
  });

  it("keeps USD for the US and rest-of-world even when enabled", () => {
    vi.stubEnv("EUR_PRICING_ENABLED", "1");
    for (const c of ["US", "GB", "CA", "AU", "JP", "BR"]) {
      expect(currencyForCountry(c), `${c} should be USD`).toBe("usd");
    }
  });

  it("falls back to USD for an unknown / missing country", () => {
    vi.stubEnv("EUR_PRICING_ENABLED", "1");
    expect(currencyForCountry(null)).toBe("usd");
    expect(currencyForCountry(undefined)).toBe("usd");
    expect(currencyForCountry("ZZ")).toBe("usd");
  });
});

describe("currencyFromRequest reads the Vercel geo header", () => {
  it("uses x-vercel-ip-country", () => {
    vi.stubEnv("EUR_PRICING_ENABLED", "1");
    const eu = new Request("http://t", { headers: { "x-vercel-ip-country": "FR" } });
    const us = new Request("http://t", { headers: { "x-vercel-ip-country": "US" } });
    const none = new Request("http://t");
    expect(currencyFromRequest(eu)).toBe("eur");
    expect(currencyFromRequest(us)).toBe("usd");
    expect(currencyFromRequest(none)).toBe("usd");
  });
});

describe("toCurrency normalizes", () => {
  it("accepts supported currencies and defaults the rest", () => {
    expect(toCurrency("usd")).toBe("usd");
    expect(toCurrency("EUR")).toBe("eur");
    expect(toCurrency("gbp")).toBe(DEFAULT_CURRENCY);
    expect(toCurrency(null)).toBe(DEFAULT_CURRENCY);
  });
});
