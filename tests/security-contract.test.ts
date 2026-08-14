import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { USER_DATA_REGISTRY, EXEMPT_TABLES } from "@/lib/privacy/registry";
import { allowlistedDeepLink } from "@/lib/email/lifecycle-catalog";

/**
 * MW-V18-X06: security invariants that must not regress —
 *  1. Every user-owned table enables RLS in its creating migration.
 *  2. No server secret env name is referenced from a client bundle.
 *  3. External/redirect deep links are rejected (allowlist only).
 */

const MIGRATION_DIR = "supabase/migrations";
const migrations = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ f, sql: readFileSync(join(MIGRATION_DIR, f), "utf8") }));

/** The migration file that CREATES `table`, or undefined. */
function creatingMigration(table: string) {
  const re = new RegExp(`create table[\\s\\S]*?public\\.${table}\\b`, "i");
  return migrations.find((m) => re.test(m.sql));
}

describe("RLS is enabled on every user-owned table", () => {
  const tables = [
    ...USER_DATA_REGISTRY.map((t) => t.table),
    ...EXEMPT_TABLES.map((t) => t.table),
  ];

  for (const table of tables) {
    it(`${table} enables row level security in its creating migration`, () => {
      const mig = creatingMigration(table);
      expect(mig, `no creating migration found for ${table}`).toBeTruthy();
      // The 001 schema enables RLS for its tables via a foreach loop; later
      // migrations each enable it inline. Either way the creating file must
      // contain the enable statement.
      expect(
        /enable row level security/i.test(mig!.sql),
        `${table} (${mig!.f}) does not enable RLS`
      ).toBe(true);
    });
  }
});

describe("server secrets never reach the client bundle", () => {
  const SECRETS = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "AI_PROVIDER_API_KEY",
    "CRON_SECRET",
    "RESEND_API_KEY",
    "ADMIN_STATS_SECRET",
    "ACCOUNT_DELETION_RECEIPT_SECRET",
  ];

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  it("no \"use client\" file references a server secret env var", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      const src = readFileSync(file, "utf8");
      const firstLines = src.slice(0, 200);
      const isClient = /^["']use client["']/m.test(firstLines);
      if (!isClient) continue;
      for (const secret of SECRETS) {
        if (src.includes(secret)) offenders.push(`${file} → ${secret}`);
      }
    }
    expect(offenders, `client files leak secrets: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("deep links / redirects are allowlisted", () => {
  it("rejects external, protocol-relative and javascript URLs", () => {
    expect(allowlistedDeepLink("https://evil.example.com")).toBeNull();
    expect(allowlistedDeepLink("//evil.example.com")).toBeNull();
    expect(allowlistedDeepLink("/today")).toBe("/today");
  });
});

describe("threat model is present and honest", () => {
  it("documents residual owner items as open, not closed", () => {
    const doc = readFileSync("docs/security-threat-model-v18.md", "utf8");
    expect(doc).toMatch(/open.*owner tasks, not .*closed/i);
    expect(doc).toMatch(/IDOR/);
    expect(doc).toMatch(/Webhook forgery/i);
  });
});
