import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pricingFor, priceDisplay, BILLING_CONTRACT } from "@/lib/stripe/plans";

/**
 * The displayed price and the charged price must be the same thing.
 *
 * Mellowa is USD-first (primary market is the US). EU/EEA buyers are charged in
 * EUR via a SEPARATE Stripe price so their cards do not fail 3DS on a foreign
 * USD charge. Each currency+interval is a fixed amount — Stripe does not
 * convert — so the display string and the charged minor units must be the same
 * authored number, per currency.
 *
 * This file pins the display strings to machine-comparable amounts;
 * `scripts/verify-stripe-prices.mjs` compares those amounts to the real Stripe
 * objects. Neither half is sufficient alone: this one cannot see Stripe, and
 * that one cannot run without production credentials.
 */

describe("USD (primary) display and contract agree", () => {
  it("monthly display matches the USD contract amount", () => {
    expect(priceDisplay("usd", "monthly")).toBe("$12.99");
    expect(BILLING_CONTRACT.usd.monthly.minorUnits).toBe(1299);
    expect(BILLING_CONTRACT.usd.monthly.interval).toBe("month");
  });

  it("yearly display matches the USD contract amount", () => {
    expect(priceDisplay("usd", "yearly")).toBe("$129.99");
    expect(BILLING_CONTRACT.usd.yearly.minorUnits).toBe(12999);
    expect(BILLING_CONTRACT.usd.yearly.interval).toBe("year");
  });

  it("derives the USD display string from the contract, digit for digit", () => {
    const render = (minor: number) => `$${(minor / 100).toFixed(2)}`;
    expect(render(BILLING_CONTRACT.usd.monthly.minorUnits)).toBe(priceDisplay("usd", "monthly"));
    expect(render(BILLING_CONTRACT.usd.yearly.minorUnits)).toBe(priceDisplay("usd", "yearly"));
  });

  it("keeps the yearly saving claim arithmetically true (USD)", () => {
    const twelveMonths = BILLING_CONTRACT.usd.monthly.minorUnits * 12;
    const saving = 1 - BILLING_CONTRACT.usd.yearly.minorUnits / twelveMonths;
    expect(saving).toBeGreaterThan(0.14); // $12.99*12=155.88 vs $129.99 ≈ 16.6%
    expect(saving).toBeLessThan(0.5);
  });
});

describe("EUR (region) display and contract agree", () => {
  it("monthly display matches the EUR contract amount", () => {
    expect(priceDisplay("eur", "monthly")).toBe("€11.99");
    expect(BILLING_CONTRACT.eur.monthly.minorUnits).toBe(1199);
    const render = (minor: number) => `€${(minor / 100).toFixed(2)}`;
    expect(render(BILLING_CONTRACT.eur.monthly.minorUnits)).toBe(priceDisplay("eur", "monthly"));
  });

  it("has no EUR yearly price yet, so yearly falls back to the USD display", () => {
    expect(BILLING_CONTRACT.eur.yearly.minorUnits).toBeNull();
    // pricingFor(eur) shows the USD yearly price because EUR yearly is not offered.
    expect(pricingFor("eur").yearly.price).toBe("$129.99");
    // ...but the monthly price is EUR.
    expect(pricingFor("eur").monthly.price).toBe("€11.99");
  });
});

describe("pricingFor reflects the requested currency", () => {
  it("USD is the default and primary", () => {
    expect(pricingFor().currency).toBe("usd");
    expect(pricingFor("usd").monthly.price.startsWith("$")).toBe(true);
  });

  it("EUR monthly is quoted in euro", () => {
    expect(pricingFor("eur").monthly.price.startsWith("€")).toBe(true);
  });
});

describe("the price verifier is wired up and checks the right things", () => {
  const script = readFileSync("scripts/verify-stripe-prices.mjs", "utf8");

  it("compares currency, amount, interval and livemode", () => {
    for (const check of ["price.currency", "price.unit_amount", "price.recurring?.interval", "price.livemode"]) {
      expect(script, `the verifier does not check ${check}`).toContain(check);
    }
  });

  it("exits non-zero on a mismatch, so it can gate a release", () => {
    expect(script).toMatch(/process\.exit\(1\)/);
  });

  it("is read-only — it must never create or modify a Stripe object", () => {
    for (const mutation of [".create(", ".update(", ".del(", ".cancel("]) {
      expect(script, `the verifier calls ${mutation}`).not.toContain(mutation);
    }
  });

  it("mirrors the amounts in BILLING_CONTRACT (both currencies)", () => {
    expect(script).toContain(String(BILLING_CONTRACT.usd.monthly.minorUnits));
    expect(script).toContain(String(BILLING_CONTRACT.usd.yearly.minorUnits));
    expect(script).toContain(String(BILLING_CONTRACT.eur.monthly.minorUnits));
  });

  it("checks the EUR amount via the price's currency_options (Model B)", () => {
    expect(script).toContain("currency_options");
    expect(script).toContain("currency_options?.eur");
  });
});

describe("a price change must not strand users behind a cached idempotency key", () => {
  const route = readFileSync("src/app/api/stripe/checkout/route.ts", "utf8");

  it("includes the price in the checkout idempotency key", () => {
    const start = route.indexOf("idempotencyKey:");
    expect(start, "no idempotency key on the checkout session").toBeGreaterThan(-1);
    const key = route.slice(start, route.indexOf("\n      }", start));
    expect(
      key,
      "the idempotency key does not vary with the price, so a price change breaks checkout for 24h"
    ).toContain("${price}");
  });

  it("still varies by user, interval, trial length and currency", () => {
    const start = route.indexOf("idempotencyKey:");
    const key = route.slice(start, route.indexOf("\n      }", start));
    for (const part of ["${user.id}", "interval", "trial", "chargedCurrency"]) {
      expect(key, `the key no longer varies by ${part}`).toContain(part);
    }
  });

  it("selects the price id by region currency (USD default, EUR for EU)", () => {
    expect(route).toContain("currencyFromRequest");
    expect(route).toContain("resolvePrice");
  });
});
