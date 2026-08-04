import { describe, expect, it } from "vitest";
import {
  PRICE_CONTRACT,
  evaluatePrice,
  evaluateProductOwnership,
  isEurWarnOnly,
} from "../scripts/price-verify-contract.mjs";

/**
 * MW-05: pure decision tests for the Stripe price verifier. These pin the RULES
 * (fail closed on missing EUR when enabled; a foreign product fails even when
 * amount/interval match) without needing Stripe.
 */

const monthly = PRICE_CONTRACT.plans.find((p) => p.label === "monthly")!;

/** A correct USD+EUR monthly price object, as Stripe would return it. */
function goodPrice(overrides: Record<string, unknown> = {}) {
  return {
    id: "price_monthly",
    currency: "usd",
    unit_amount: monthly.usd,
    recurring: { interval: "month" },
    active: true,
    livemode: false,
    currency_options: { eur: { unit_amount: monthly.eur } },
    ...overrides,
  };
}

describe("evaluatePrice — core amount/interval/mode rules", () => {
  it("passes a correct USD+EUR price", () => {
    expect(evaluatePrice(goodPrice(), monthly, { mode: "TEST", eurRequired: true })).toEqual([]);
  });

  it("flags a wrong USD amount", () => {
    const p = evaluatePrice(goodPrice({ unit_amount: 999 }), monthly, { mode: "TEST", eurRequired: false });
    expect(p.join(" ")).toMatch(/USD amount is 999/);
  });

  it("flags a non-USD default currency", () => {
    const p = evaluatePrice(goodPrice({ currency: "eur" }), monthly, { mode: "TEST", eurRequired: false });
    expect(p.join(" ")).toMatch(/default currency is "eur"/);
  });

  it("flags a wrong interval and an inactive price", () => {
    const p = evaluatePrice(
      goodPrice({ recurring: { interval: "year" }, active: false }),
      monthly,
      { mode: "TEST", eurRequired: false }
    );
    expect(p.join(" ")).toMatch(/interval is "year"/);
    expect(p.join(" ")).toMatch(/archived\/inactive/);
  });

  it("flags a TEST price configured in LIVE env", () => {
    const p = evaluatePrice(goodPrice({ livemode: false }), monthly, { mode: "LIVE", eurRequired: true });
    expect(p.join(" ")).toMatch(/TEST price is configured in live env/);
  });
});

describe("evaluatePrice — EUR fails closed when enabled", () => {
  it("HARD-fails a missing EUR option when EUR pricing is enabled", () => {
    const p = evaluatePrice(goodPrice({ currency_options: {} }), monthly, { mode: "TEST", eurRequired: true });
    expect(p.join(" ")).toMatch(/EUR currency_option is missing but EUR pricing is ENABLED/);
  });

  it("does NOT fail a missing EUR option when EUR pricing is disabled (warn only)", () => {
    const price = goodPrice({ currency_options: {} });
    expect(evaluatePrice(price, monthly, { mode: "TEST", eurRequired: false })).toEqual([]);
    expect(isEurWarnOnly(price, monthly, { eurRequired: false })).toBe(true);
  });

  it("flags a present-but-wrong EUR amount regardless of the flag", () => {
    const p = evaluatePrice(
      goodPrice({ currency_options: { eur: { unit_amount: 111 } } }),
      monthly,
      { mode: "TEST", eurRequired: false }
    );
    expect(p.join(" ")).toMatch(/EUR currency_option is 111/);
  });
});

describe("evaluateProductOwnership — shared Stripe account", () => {
  it("passes a product owned by app metadata", () => {
    expect(
      evaluateProductOwnership({ id: "prod_1", active: true, metadata: { app: "mellowa" } })
    ).toEqual([]);
  });

  it("passes a product matched by the allowlisted id", () => {
    expect(
      evaluateProductOwnership({ id: "prod_allow", active: true, metadata: {} }, { allowlistId: "prod_allow" })
    ).toEqual([]);
  });

  it("FAILS a foreign product even though the price amount/interval matched", () => {
    // This is the shared-account trap: a Scalvya/Frost price could match on
    // amount + interval, but its product is not ours.
    const p = evaluateProductOwnership({ id: "prod_scalvya", active: true, metadata: { app: "scalvya" } });
    expect(p.join(" ")).toMatch(/not confirmed to belong to this app/);
  });

  it("fails an inactive product", () => {
    const p = evaluateProductOwnership({ id: "prod_1", active: false, metadata: { app: "mellowa" } });
    expect(p.join(" ")).toMatch(/product prod_1 is inactive/);
  });

  it("fails when there is no product to check (fail closed)", () => {
    expect(evaluateProductOwnership(undefined).join(" ")).toMatch(/no expanded product/);
  });
});
