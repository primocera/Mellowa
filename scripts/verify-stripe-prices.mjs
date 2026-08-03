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

// Mirrors BILLING_CONTRACT in src/lib/stripe/plans.ts. ONE price id per
// interval, each carrying a USD default amount and an OPTIONAL EUR
// currency_option (Scalvya's model). Kept in sync by
// tests/billing-contract.test.ts.
//
// `usd` is the price's default currency + unit_amount. `eur` (optional) is the
// amount under price.currency_options.eur — absent is a warning, not a failure,
// because checkout only sends EUR when EUR_PRICING_ENABLED is on.
const CONTRACT = {
  plans: [
    { label: "monthly", envVar: "STRIPE_PRICE_PRO_MONTHLY", interval: "month", usd: 1299, usdDisplay: "$12.99", eur: 1199, eurDisplay: "€11.99" },
    { label: "yearly", envVar: "STRIPE_PRICE_PRO_YEARLY", interval: "year", usd: 12999, usdDisplay: "$129.99", eur: null, eurDisplay: null },
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
  const id = read(plan.envVar);
  if (!id) {
    failures.push(`${plan.envVar} is not set`);
    continue;
  }

  let price;
  try {
    // expand currency_options so the EUR amount is present on the object.
    price = await stripe.prices.retrieve(id, { expand: ["currency_options"] });
  } catch (error) {
    failures.push(`${plan.envVar} (${id}) could not be retrieved: ${error.message}`);
    continue;
  }

  const problems = [];
  // USD is the price's default currency + unit_amount.
  if (price.currency !== "usd") {
    problems.push(
      `default currency is "${price.currency}" but USD is primary — it should be usd (${plan.usdDisplay})`
    );
  }
  if (price.unit_amount !== plan.usd) {
    problems.push(`USD amount is ${price.unit_amount} but the product promises ${plan.usd} (${plan.usdDisplay})`);
  }
  if (price.recurring?.interval !== plan.interval) {
    problems.push(`interval is "${price.recurring?.interval}" but should be "${plan.interval}"`);
  }
  if (!price.active) problems.push("price is archived/inactive");
  if (mode === "LIVE" && !price.livemode) problems.push("a TEST price is configured in live env");
  if (mode === "TEST" && price.livemode) problems.push("a LIVE price is configured in test env");

  // EUR currency_option (optional): warn if absent, fail if present but wrong.
  const eurOption = price.currency_options?.eur;
  let eurNote = "eur: none";
  if (plan.eur != null) {
    if (!eurOption) {
      console.log(`WARN ${plan.label.padEnd(8)} no EUR currency_option — EU buyers will fall back to USD until you add ${plan.eurDisplay}`);
    } else if (eurOption.unit_amount !== plan.eur) {
      problems.push(`EUR currency_option is ${eurOption.unit_amount} but the product promises ${plan.eur} (${plan.eurDisplay})`);
    } else {
      eurNote = `eur ${eurOption.unit_amount}`;
    }
  } else if (eurOption) {
    eurNote = `eur ${eurOption.unit_amount} (not in contract yet)`;
  }

  const status = problems.length === 0 ? "OK " : "FAIL";
  console.log(
    `${status} ${plan.label.padEnd(8)} ${price.id}  ${price.unit_amount} ${price.currency} / ${price.recurring?.interval}  · ${eurNote}`
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
