#!/usr/bin/env node
/**
 * Safe, one-way secret fingerprints (MW-V12-05).
 *
 * Rotating a secret is only verifiable if you can answer "is the value now
 * deployed the new one?" — and `release-check` cannot, because it checks
 * presence, not identity. Printing the value to compare it would defeat the
 * point. This prints a short, one-way fingerprint instead: a truncated
 * SHA-256, which lets you confirm two environments hold the SAME secret (or
 * that prod now holds the NEW one) without ever revealing or reconstructing it.
 *
 * It NEVER prints a secret value, prefix or suffix. The fingerprint is 12 hex
 * characters (48 bits) of SHA-256 — enough to compare, far too little to
 * reverse or to confirm a guessed value with confidence.
 *
 * Usage:
 *   node scripts/secret-fingerprint.mjs CRON_SECRET STRIPE_WEBHOOK_SECRET ...
 *   node scripts/secret-fingerprint.mjs --env .env.production.local CRON_SECRET
 *
 * Compare the output between the value you generated and the deployed env
 * (`vercel env pull`) to verify a rotation landed. Read-only; changes nothing.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** 12 hex chars = 48 bits. Enough to compare; not enough to attack. */
const FINGERPRINT_HEX = 12;

function fingerprint(value) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, FINGERPRINT_HEX);
}

function loadEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^"|"$/g, "");
    }
  } catch {
    /* absent file is fine — real env still wins */
  }
  return out;
}

const args = process.argv.slice(2);
let fileEnv = {};
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--env") {
    fileEnv = loadEnvFile(args[++i] ?? ".env.local");
  } else {
    names.push(args[i]);
  }
}

if (names.length === 0) {
  console.error(
    "Usage: node scripts/secret-fingerprint.mjs [--env <file>] NAME [NAME ...]\n" +
      "Prints a 12-hex one-way fingerprint per secret. Never prints the value.",
  );
  process.exit(2);
}

console.log("Secret fingerprints (SHA-256, first 12 hex — never the value):\n");
let missing = 0;
for (const name of names) {
  const value = process.env[name] ?? fileEnv[name];
  if (!value) {
    missing += 1;
    console.log(`  ${name.padEnd(28)} (not set)`);
    continue;
  }
  // Guard: never emit anything derived from the raw value except the hash.
  console.log(`  ${name.padEnd(28)} ${fingerprint(value)}  (len ${value.length})`);
}

console.log(
  "\nCompare these between environments to confirm a rotation. Matching " +
    "fingerprints = same secret; a changed fingerprint after a rotation = the " +
    "new value is deployed.",
);
process.exit(missing > 0 ? 1 : 0);
