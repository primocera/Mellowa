import { describe, expect, it } from "vitest";
import {
  CATALOG,
  formatMinorUnits,
  planSavings,
  pricingFor,
  savingsCopy,
} from "@/lib/stripe/plans";
import { CURRENCIES, type Currency } from "@/lib/stripe/currency";

/**
 * MW-02: yearly-vs-monthly savings must be DERIVED from the one catalog per
 * currency, in integer minor units, and reconcile exactly. Nothing here
 * hardcodes 16.6% or an amount — every expectation is computed from CATALOG so
 * the test fails the moment a catalog value changes without the helper keeping
 * up, and passes for whatever the authored amounts happen to be.
 */

describe("formatMinorUnits is decimal-safe", () => {
  it("renders whole minor units with the currency symbol", () => {
    expect(formatMinorUnits("usd", 1299)).toBe("$12.99");
    expect(formatMinorUnits("usd", 12999)).toBe("$129.99");
    expect(formatMinorUnits("eur", 1199)).toBe("€11.99");
    expect(formatMinorUnits("eur", 11999)).toBe("€119.99");
  });

  it("keeps trailing zeros (never binary-float drift)", () => {
    expect(formatMinorUnits("usd", 1000)).toBe("$10.00");
    expect(formatMinorUnits("usd", 1080)).toBe("$10.80");
  });
});

describe.each(CURRENCIES)("planSavings(%s) reconciles exactly", (currency: Currency) => {
  const monthlyMinor = CATALOG[currency].monthly.minorUnits;
  const yearlyMinor = CATALOG[currency].yearly.minorUnits;
  const s = planSavings(currency);

  it("uses the catalog minor units for both intervals", () => {
    expect(s.monthlyMinor).toBe(monthlyMinor);
    expect(s.yearlyMinor).toBe(yearlyMinor);
  });

  it("twelve-month total is 12 monthly charges", () => {
    expect(s.twelveMonthTotalMinor).toBe(monthlyMinor * 12);
  });

  it("absolute saving is twelve-month total minus yearly", () => {
    expect(s.absoluteSavingMinor).toBe(monthlyMinor * 12 - yearlyMinor);
  });

  it("monthly-equivalent is the yearly price over 12 (rounded)", () => {
    expect(s.yearlyMonthlyEquivMinor).toBe(Math.round(yearlyMinor / 12));
  });

  it("percent saving is derived, not a hardcoded 50%", () => {
    const expected = Math.round(((monthlyMinor * 12 - yearlyMinor) / (monthlyMinor * 12)) * 100);
    expect(s.percentSaving).toBe(expected);
    // At the current amounts this is ~16.6% -> 17, and definitely not 50.
    expect(s.percentSaving).not.toBe(50);
    expect(s.percentSaving).toBeGreaterThan(0);
  });

  it("display strings match formatMinorUnits for the same currency", () => {
    expect(s.monthlyDisplay).toBe(formatMinorUnits(currency, s.monthlyMinor));
    expect(s.yearlyDisplay).toBe(formatMinorUnits(currency, s.yearlyMinor));
    expect(s.monthlyEquivDisplay).toBe(formatMinorUnits(currency, s.yearlyMonthlyEquivMinor));
    expect(s.twelveMonthTotalDisplay).toBe(formatMinorUnits(currency, s.twelveMonthTotalMinor));
    expect(s.absoluteSavingDisplay).toBe(formatMinorUnits(currency, s.absoluteSavingMinor));
  });
});

describe("savingsCopy stays within one currency", () => {
  const foreignSymbol: Record<Currency, string> = { usd: "€", eur: "$" };

  it.each(CURRENCIES)("%s copy contains only its own currency symbol", (currency: Currency) => {
    const copy = savingsCopy(currency);
    const ownSymbol = CATALOG[currency].symbol;
    for (const line of [copy.badge, copy.monthlyEquivShort, copy.monthlyEquivNote, copy.arithmetic]) {
      expect(line).toContain(ownSymbol);
      expect(line, `"${line}" leaked ${foreignSymbol[currency]}`).not.toContain(foreignSymbol[currency]);
    }
  });

  it("badge equals the derived absolute saving, never a percent", () => {
    for (const currency of CURRENCIES) {
      const s = planSavings(currency);
      expect(savingsCopy(currency).badge).toBe(`Save ${s.absoluteSavingDisplay}`);
      expect(savingsCopy(currency).badge).not.toMatch(/%/);
    }
  });

  it("pricingFor yearly note is the derived badge, not 'Save 50%'", () => {
    for (const currency of CURRENCIES) {
      expect(pricingFor(currency).yearly.note).toBe(savingsCopy(currency).badge);
      expect(pricingFor(currency).yearly.note).not.toContain("50%");
    }
  });
});
