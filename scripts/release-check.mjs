#!/usr/bin/env node
/**
 * Release checker (Launch audit v6, Prompt 8).
 *
 * Verifies deployment configuration and live readiness WITHOUT printing any
 * secret value — only present / missing / mismatch and safe identifiers.
 *
 * Usage:
 *   node scripts/release-check.mjs                # env checks only
 *   APP_URL=https://mellowa.app ADMIN_STATS_SECRET=... node scripts/release-check.mjs
 *                                                 # + live health/readiness
 *
 * Reads the local environment (run with the production env pulled, e.g.
 * `vercel env pull .env.production.local` — note Sensitive vars pull empty).
 */

const REQUIRED_ENV = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AI_PROVIDER_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_YEARLY",
  "CRON_SECRET",
  "ADMIN_STATS_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
];

const PAID_LAUNCH_ENV = [
  "LEGAL_ENTITY_NAME",
  "LEGAL_REGISTERED_ADDRESS",
  "LEGAL_GOVERNING_LAW",
  "SUPPORT_EMAIL",
];

let failures = 0;
let warnings = 0;
const ok = (msg) => console.log(`  ok       ${msg}`);
const warn = (msg) => {
  warnings += 1;
  console.log(`  WARN     ${msg}`);
};
const fail = (msg) => {
  failures += 1;
  console.log(`  MISSING  ${msg}`);
};

console.log("Release check — environment presence (values never printed)\n");

for (const name of REQUIRED_ENV) {
  if (process.env[name]) ok(name);
  else fail(name);
}

console.log("\nPaid-launch identity (LAUNCH_MODE=paid requires all of these)");
for (const name of PAID_LAUNCH_ENV) {
  if (process.env[name]) ok(name);
  else (process.env.LAUNCH_MODE === "paid" ? fail : warn)(name);
}

console.log("\nValue sanity (no values shown)");
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
if (/localhost|\.vercel\.app/i.test(appUrl)) {
  warn("NEXT_PUBLIC_APP_URL points at a temporary domain");
} else if (appUrl.startsWith("https://")) {
  ok("NEXT_PUBLIC_APP_URL is an https production domain");
} else if (appUrl) {
  fail("NEXT_PUBLIC_APP_URL is not https");
}
if (/resend\.dev/i.test(process.env.EMAIL_FROM ?? "")) {
  warn("EMAIL_FROM uses the resend.dev placeholder domain");
}
if ((process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_")) {
  warn("STRIPE_SECRET_KEY is a TEST key (fine for beta, not for paid launch)");
}
if ((process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_")) {
  ok("STRIPE_SECRET_KEY is a live key");
}

const base = process.env.APP_URL ?? "";
if (base) {
  console.log(`\nLive checks against ${base}`);
  try {
    const health = await fetch(`${base}/api/health`);
    const body = await health.json().catch(() => ({}));
    if (health.ok) ok(`/api/health (version ${body.version ?? "?"})`);
    else fail(`/api/health returned ${health.status}`);
  } catch {
    fail("/api/health unreachable");
  }

  const adminSecret = process.env.ADMIN_STATS_SECRET;
  if (adminSecret) {
    try {
      const ready = await fetch(`${base}/api/health/ready`, {
        headers: { Authorization: `Bearer ${adminSecret}` },
      });
      const body = await ready.json().catch(() => ({}));
      for (const [name, status] of Object.entries(body.components ?? {})) {
        if (status === "ok") ok(`ready: ${name}`);
        else if (status === "not_configured") warn(`ready: ${name} not configured`);
        else fail(`ready: ${name}`);
      }
      if (!ready.ok && !Object.keys(body.components ?? {}).length) {
        fail(`/api/health/ready returned ${ready.status}`);
      }
    } catch {
      fail("/api/health/ready unreachable");
    }
  } else {
    warn("ADMIN_STATS_SECRET not set — skipping deep readiness");
  }
} else {
  console.log("\n(Set APP_URL to also run live health checks.)");
}

console.log(
  `\nResult: ${failures} failing, ${warnings} warnings.` +
    (failures ? " NOT ready." : warnings ? " Ready with warnings." : " Ready.")
);
process.exit(failures ? 1 : 0);
