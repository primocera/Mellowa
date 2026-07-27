import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRICING, BILLING_CONTRACT } from "@/lib/stripe/plans";

/**
 * The displayed price and the charged price must be the same thing.
 *
 * They were not. Every customer surface promised €9.99 / €59.99 while the live
 * Stripe prices were created in **USD**. Stripe does not convert, so a user who
 * read "€9.99" was charged $9.99, their bank converted at its own rate and
 * added a foreign-transaction fee, and the amount actually taken was never a
 * number this product had shown them. It also very likely caused the card
 * declines during the launch rehearsal — an EU card asked to authorise a USD
 * charge from an EU merchant is the shape issuers refuse after 3DS.
 *
 * Nothing caught it. `release-check` verified the price IDs were set, never
 * what they cost. The 1076-test suite asserted the display strings against each
 * other and never against Stripe.
 *
 * This file pins the display strings to machine-comparable amounts;
 * `scripts/verify-stripe-prices.mjs` compares those amounts to the real Stripe
 * objects. Neither half is sufficient alone: this one cannot see Stripe, and
 * that one cannot run without production credentials.
 */

describe("the displayed price and the billing contract agree", () => {
  it("monthly display matches the contract amount", () => {
    expect(PRICING.monthly.price).toBe("€9.99");
    expect(BILLING_CONTRACT.monthly.minorUnits).toBe(999);
    expect(BILLING_CONTRACT.monthly.interval).toBe("month");
  });

  it("yearly display matches the contract amount", () => {
    expect(PRICING.yearly.price).toBe("€59.99");
    expect(BILLING_CONTRACT.yearly.minorUnits).toBe(5999);
    expect(BILLING_CONTRACT.yearly.interval).toBe("year");
  });

  it("derives the display string from the contract, digit for digit", () => {
    // Guards the drift directly: change one number and this fails.
    const render = (minor: number) => `€${(minor / 100).toFixed(2)}`;
    expect(render(BILLING_CONTRACT.monthly.minorUnits)).toBe(PRICING.monthly.price);
    expect(render(BILLING_CONTRACT.yearly.minorUnits)).toBe(PRICING.yearly.price);
  });

  it("states one currency, and it is the one the copy shows", () => {
    expect(BILLING_CONTRACT.currency).toBe("eur");
    expect(PRICING.monthly.price.startsWith("€")).toBe(true);
    expect(PRICING.yearly.price.startsWith("€")).toBe(true);
  });

  it("names the same env vars the checkout route resolves", () => {
    expect(BILLING_CONTRACT.monthly.envVar).toBe(PRICING.monthly.priceEnvVar);
    expect(BILLING_CONTRACT.yearly.envVar).toBe(PRICING.yearly.priceEnvVar);
  });

  it("keeps the yearly saving claim arithmetically true", () => {
    // "Save 50% compared to monthly" is a checkable claim, so check it.
    const twelveMonths = BILLING_CONTRACT.monthly.minorUnits * 12;
    const saving = 1 - BILLING_CONTRACT.yearly.minorUnits / twelveMonths;
    expect(saving).toBeGreaterThan(0.49);
    expect(saving).toBeLessThan(0.51);
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

  it("mirrors the amounts in BILLING_CONTRACT", () => {
    expect(script).toContain(String(BILLING_CONTRACT.monthly.minorUnits));
    expect(script).toContain(String(BILLING_CONTRACT.yearly.minorUnits));
    expect(script).toContain(`currency: "${BILLING_CONTRACT.currency}"`);
  });
});
