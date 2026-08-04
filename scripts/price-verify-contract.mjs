// Pure, dependency-free decision logic for verify-stripe-prices.mjs, so the
// pass/fail RULES can be unit-tested (tests/price-verify.test.ts) without hitting
// Stripe. The script does the I/O (read env, retrieve prices/products); every
// judgement lives here.

// Mirrors BILLING_CONTRACT in src/lib/stripe/plans.ts. ONE price id per
// interval, each carrying a USD default amount and a EUR currency_option.
// Kept in sync by tests/billing-contract.test.ts.
export const PRICE_CONTRACT = {
  plans: [
    { label: "monthly", envVar: "STRIPE_PRICE_PRO_MONTHLY", interval: "month", usd: 1299, usdDisplay: "$12.99", eur: 1199, eurDisplay: "€11.99" },
    { label: "yearly", envVar: "STRIPE_PRICE_PRO_YEARLY", interval: "year", usd: 12999, usdDisplay: "$129.99", eur: 11999, eurDisplay: "€119.99" },
  ],
};

/**
 * Evaluate one Stripe price object against a plan.
 * opts: { mode: "LIVE" | "TEST", eurRequired: boolean }
 * Returns an array of problem strings (empty = OK).
 *
 * MW-05: when EUR pricing is ENABLED, a missing EUR currency_option is a HARD
 * failure, not a warning. Checkout passes currency=eur with NO USD fallback
 * (resolvePrice), so a missing EUR option means EU buyers are mischarged or
 * their payment fails — the display and the charge can no longer agree.
 */
export function evaluatePrice(price, plan, opts) {
  const problems = [];
  if (!price) {
    problems.push(`${plan.envVar}: price could not be retrieved`);
    return problems;
  }
  if (price.currency !== "usd") {
    problems.push(`default currency is "${price.currency}" but USD is primary — it should be usd (${plan.usdDisplay})`);
  }
  if (price.unit_amount !== plan.usd) {
    problems.push(`USD amount is ${price.unit_amount} but the product promises ${plan.usd} (${plan.usdDisplay})`);
  }
  if (price.recurring?.interval !== plan.interval) {
    problems.push(`interval is "${price.recurring?.interval}" but should be "${plan.interval}"`);
  }
  if (!price.active) problems.push("price is archived/inactive");
  if (opts.mode === "LIVE" && !price.livemode) problems.push("a TEST price is configured in live env");
  if (opts.mode === "TEST" && price.livemode) problems.push("a LIVE price is configured in test env");

  const eurOption = price.currency_options?.eur;
  if (plan.eur != null) {
    if (!eurOption) {
      if (opts.eurRequired) {
        problems.push(`EUR currency_option is missing but EUR pricing is ENABLED — checkout charges EUR with no fallback; add ${plan.eurDisplay}`);
      }
      // else: a warning only (surfaced by the script), because with EUR pricing
      // disabled every buyer pays USD and the EUR option is unused.
    } else if (eurOption.unit_amount !== plan.eur) {
      problems.push(`EUR currency_option is ${eurOption.unit_amount} but the product promises ${plan.eur} (${plan.eurDisplay})`);
    }
  }
  return problems;
}

/** True when the EUR option is absent but only a warning (EUR pricing off). */
export function isEurWarnOnly(price, plan, opts) {
  return plan.eur != null && !price?.currency_options?.eur && !opts.eurRequired;
}

/**
 * Evaluate that a price's product actually belongs to THIS app. The Stripe
 * account is shared with other products (Scalvya, Frost); a price from a foreign
 * product must fail even if its amount and interval happen to match.
 *
 * opts: { allowlistId?: string, appMetadataValue?: string ("mellowa") }
 * Ownership is confirmed by an allowlisted product id OR stable metadata
 * app=<value>. Neither present = not confirmed = failure (fail closed).
 */
export function evaluateProductOwnership(product, opts = {}) {
  const problems = [];
  const app = opts.appMetadataValue ?? "mellowa";
  if (!product || typeof product !== "object") {
    problems.push("price has no expanded product to verify ownership against");
    return problems;
  }
  if (product.active === false) problems.push(`product ${product.id} is inactive`);
  const ownedByAllowlist = Boolean(opts.allowlistId) && product.id === opts.allowlistId;
  const ownedByMetadata = product.metadata?.app === app;
  if (!ownedByAllowlist && !ownedByMetadata) {
    problems.push(
      `product ${product.id} is not confirmed to belong to this app — set STRIPE_PRODUCT_ID to its id or add product metadata app=${app}`
    );
  }
  return problems;
}
