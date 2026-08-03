// Attach a EUR currency_option onto the existing USD prices (Scalvya's model).
//
// Mellowa charges EU/EEA buyers in EUR on the SAME price id the app already
// uses, via Stripe currency_options. The Dashboard cannot add a currency to an
// existing price (it makes a new one), but the API can update currency_options
// in place — which keeps the price id stable, so no env repointing is needed.
//
// This WRITES to Stripe (price.update). It never changes the USD base amount,
// only adds/updates the EUR option. It never creates, archives, cancels or
// deletes anything, and never prints the key. Run it once; re-running is safe
// (idempotent — it sets the same EUR amount).
//
// Usage:
//   node scripts/add-eur-currency.mjs keys.txt        (or any env file with the
//                                                       live key + price ids)
//   node scripts/add-eur-currency.mjs --dry-run keys.txt   (show what it WOULD do)
//
// After it runs, confirm with:  node scripts/verify-stripe-prices.mjs keys.txt
import { readFileSync } from "node:fs";
import Stripe from "stripe";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const envPath = args.find((a) => !a.startsWith("--")) ?? ".env.local";

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

const read = (name) => process.env[name] ?? env[name];

const secret = read("STRIPE_SECRET_KEY");
if (!secret) {
  console.error("STRIPE_SECRET_KEY is not set — cannot continue.");
  process.exit(1);
}

// Mirrors BILLING_CONTRACT eur amounts in src/lib/stripe/plans.ts.
const PLANS = [
  { label: "monthly", envVar: "STRIPE_PRICE_PRO_MONTHLY", eur: 1199, eurDisplay: "€11.99" },
  { label: "yearly", envVar: "STRIPE_PRICE_PRO_YEARLY", eur: 11999, eurDisplay: "€119.99" },
];

const stripe = new Stripe(secret);
const mode = secret.startsWith("sk_live") ? "LIVE" : "TEST";
console.log(`Adding EUR currency_options (${mode} mode, env: ${envPath})${dryRun ? " · DRY RUN" : ""}\n`);

let failures = 0;

for (const plan of PLANS) {
  const id = read(plan.envVar);
  if (!id) {
    console.error(`FAIL ${plan.label}: ${plan.envVar} is not set`);
    failures++;
    continue;
  }

  // Read the current price so we never touch the USD base amount.
  let price;
  try {
    price = await stripe.prices.retrieve(id, { expand: ["currency_options"] });
  } catch (error) {
    console.error(`FAIL ${plan.label}: could not retrieve ${id}: ${error.message}`);
    failures++;
    continue;
  }

  const existingEur = price.currency_options?.eur?.unit_amount ?? null;
  if (existingEur === plan.eur) {
    console.log(`OK   ${plan.label.padEnd(8)} ${id}  already has eur ${plan.eur} — nothing to do`);
    continue;
  }

  if (dryRun) {
    console.log(
      `WOULD ${plan.label.padEnd(7)} ${id}  set currency_options.eur = ${plan.eur} (${plan.eurDisplay})` +
        (existingEur != null ? ` (was ${existingEur})` : "")
    );
    continue;
  }

  try {
    await stripe.prices.update(id, {
      currency_options: { eur: { unit_amount: plan.eur } },
    });
    console.log(`SET  ${plan.label.padEnd(8)} ${id}  currency_options.eur = ${plan.eur} (${plan.eurDisplay})`);
  } catch (error) {
    console.error(`FAIL ${plan.label}: update failed: ${error.message}`);
    failures++;
  }
}

console.log("");
if (failures > 0) {
  console.error(`${failures} failure(s). Nothing else changed.`);
  process.exit(1);
}
console.log(
  dryRun
    ? "Dry run only — no change made. Re-run without --dry-run to apply."
    : "Done. Now run: node scripts/verify-stripe-prices.mjs " + envPath
);
