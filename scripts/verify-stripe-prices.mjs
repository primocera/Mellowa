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

// Mirrors BILLING_CONTRACT in src/lib/stripe/plans.ts (dual currency: USD is
// primary, EUR is the EU/EEA region price). Kept in sync by
// tests/billing-contract.test.ts, which fails if the two disagree.
//
// USD prices are REQUIRED (fall back to the legacy unsuffixed env var). EUR
// prices are OPTIONAL — a currency+interval with no env id is skipped, not
// failed, because checkout falls back to USD when a EUR price is absent.
const CONTRACT = {
  plans: [
    { label: "usd/monthly", currency: "usd", envVar: "STRIPE_PRICE_PRO_MONTHLY_USD", fallbackEnvVar: "STRIPE_PRICE_PRO_MONTHLY", minorUnits: 1299, interval: "month", display: "$12.99", required: true },
    { label: "usd/yearly", currency: "usd", envVar: "STRIPE_PRICE_PRO_YEARLY_USD", fallbackEnvVar: "STRIPE_PRICE_PRO_YEARLY", minorUnits: 12999, interval: "year", display: "$129.99", required: true },
    { label: "eur/monthly", currency: "eur", envVar: "STRIPE_PRICE_PRO_MONTHLY_EUR", minorUnits: 1199, interval: "month", display: "€11.99", required: false },
  ],
};

const stripe = new Stripe(secret);
const mode = secret.startsWith("sk_live") ? "LIVE" : "TEST";
console.log(`Verifying Stripe prices (${mode} mode, env: ${envPath})\n`);

const failures = [];

const account = await stripe.accounts.retrieve();
console.log(`Account ${account.id} · default currency ${account.default_currency}`);
if (mode === "LIVE" && !account.charges_enabled) {
  failures.push("account cannot accept live charges (charges_enabled is false)");
}

for (const plan of CONTRACT.plans) {
  const id = read(plan.envVar) ?? (plan.fallbackEnvVar ? read(plan.fallbackEnvVar) : undefined);
  if (!id) {
    if (plan.required) {
      failures.push(`${plan.envVar} is not set`);
    } else {
      console.log(`SKIP ${plan.label.padEnd(11)} (${plan.envVar} not set — checkout falls back to USD)`);
    }
    continue;
  }

  let price;
  try {
    price = await stripe.prices.retrieve(id);
  } catch (error) {
    failures.push(`${plan.envVar} (${id}) could not be retrieved: ${error.message}`);
    continue;
  }

  const problems = [];
  if (price.currency !== plan.currency) {
    problems.push(
      `currency is "${price.currency}" but this surface promises ${plan.display} (${plan.currency}) — ` +
        `Stripe does not convert, so the customer would be billed in ${price.currency.toUpperCase()}`
    );
  }
  if (price.unit_amount !== plan.minorUnits) {
    problems.push(`amount is ${price.unit_amount} but the product promises ${plan.minorUnits}`);
  }
  if (price.recurring?.interval !== plan.interval) {
    problems.push(`interval is "${price.recurring?.interval}" but should be "${plan.interval}"`);
  }
  if (!price.active) problems.push("price is archived/inactive");
  if (mode === "LIVE" && !price.livemode) problems.push("a TEST price is configured in live env");
  if (mode === "TEST" && price.livemode) problems.push("a LIVE price is configured in test env");

  const status = problems.length === 0 ? "OK " : "FAIL";
  console.log(
    `${status} ${plan.label.padEnd(11)} ${price.id}  ${price.unit_amount} ${price.currency} / ${price.recurring?.interval}`
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
