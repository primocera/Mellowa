// Verify the configured Stripe prices are what the product actually promises.
//
// Read-only. Creates nothing, changes nothing, and never prints a key.
//
// Why this exists: the live prices were created in USD while every customer
// surface promised EUR. A user reading "€9.99" reached a checkout charging
// $9.99, their bank converted at its own rate and added a foreign-transaction
// fee, and the amount taken was never a number the product had shown them. It
// also very likely caused the card declines during the launch rehearsal: an EU
// card being asked to authorise a USD charge from an EU merchant is exactly the
// shape issuers refuse after 3DS.
//
// `npm run release-check` did not catch it, because it verified only that the
// price IDs were set — not what they cost or in what currency.
//
// Usage:
//   node scripts/verify-stripe-prices.mjs                 (reads .env.local)
//   node scripts/verify-stripe-prices.mjs path/to/env     (e.g. a pulled prod env)
//
// Exits non-zero on any mismatch, so it can gate a release.
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import {
  PRICE_CONTRACT,
  evaluatePrice,
  evaluateProductOwnership,
  isEurWarnOnly,
} from "./price-verify-contract.mjs";

const envPath = process.argv[2] ?? ".env.local";

let env;
try {
  env = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
      })
  );
} catch {
  console.error(`Could not read ${envPath}`);
  process.exit(1);
}

// Real environment wins, so CI can pass secrets without a file.
const read = (name) => process.env[name] ?? env[name];

const secret = read("STRIPE_SECRET_KEY");
if (!secret) {
  console.error("STRIPE_SECRET_KEY is not set — cannot verify prices.");
  process.exit(1);
}

const stripe = new Stripe(secret);
const mode = secret.startsWith("sk_live") ? "LIVE" : "TEST";
// MW-05: when EUR pricing is enabled, a missing EUR currency_option is a HARD
// failure — checkout passes currency=eur with no fallback.
const eurRequired = read("EUR_PRICING_ENABLED") === "1";
// Optional allowlisted product id; ownership is otherwise confirmed by metadata
// app=mellowa on the price's product (shared Stripe account).
const allowlistId = read("STRIPE_PRODUCT_ID");
console.log(
  `Verifying Stripe prices (${mode} mode, env: ${envPath}, EUR ${eurRequired ? "ENABLED" : "disabled"})\n`
);

const failures = [];

const account = await stripe.accounts.retrieve();
console.log(`Account ${account.id} · default currency ${account.default_currency}`);
if (mode === "LIVE" && !account.charges_enabled) {
  failures.push("account cannot accept live charges (charges_enabled is false)");
}

for (const plan of PRICE_CONTRACT.plans) {
  const id = read(plan.envVar);
  if (!id) {
    failures.push(`${plan.envVar} is not set`);
    continue;
  }

  let price;
  try {
    // expand currency_options (EUR amount) and product (ownership check).
    price = await stripe.prices.retrieve(id, { expand: ["currency_options", "product"] });
  } catch (error) {
    failures.push(`${plan.envVar} (${id}) could not be retrieved: ${error.message}`);
    continue;
  }

  // Pure decision logic (unit-tested in tests/price-verify.test.ts).
  const problems = [
    ...evaluatePrice(price, plan, { mode, eurRequired }),
    ...evaluateProductOwnership(price.product, { allowlistId, appMetadataValue: "mellowa" }),
  ];

  if (isEurWarnOnly(price, plan, { eurRequired })) {
    console.log(
      `WARN ${plan.label.padEnd(8)} no EUR currency_option (EUR pricing off, so unused) — add ${plan.eurDisplay} before enabling EUR`
    );
  }

  const eurOption = price.currency_options?.eur;
  const eurNote = eurOption ? `eur ${eurOption.unit_amount}` : "eur: none";
  const productId = typeof price.product === "object" ? price.product?.id : price.product;
  const status = problems.length === 0 ? "OK " : "FAIL";
  console.log(
    `${status} ${plan.label.padEnd(8)} ${price.id}  ${price.unit_amount} ${price.currency} / ${price.recurring?.interval}  · ${eurNote} · product ${productId}`
  );
  for (const problem of problems) {
    console.log(`       ↳ ${problem}`);
    failures.push(`${plan.label}: ${problem}`);
  }
}

console.log("");
if (failures.length > 0) {
  console.error(`NOT READY — ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log("All configured prices match the product's stated pricing.");
