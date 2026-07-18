import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static DB-security gate (Launch v6, Prompt 16). Scans every migration so a
 * new function or table can't ship without the hardening rules:
 * - SECURITY DEFINER ⇒ pinned search_path (search-path hijack protection)
 * - p_user_id + authenticated grant ⇒ auth.uid() guard in the body
 * - every created table enables row level security
 * Runtime adversarial checks live in supabase/checks/rls-audit.sql.
 */

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
const sqlByFile = new Map(files.map((f) => [f, readFileSync(join(dir, f), "utf8").toLowerCase()]));
const allSql = [...sqlByFile.values()].join("\n");

/** Splits a migration into individual function bodies. */
function functionBlocks(sql: string): string[] {
  return sql.split(/create or replace function|create function/).slice(1);
}

describe("migration security gate", () => {
  it("every SECURITY DEFINER function pins search_path", () => {
    for (const [file, sql] of sqlByFile) {
      for (const block of functionBlocks(sql)) {
        const head = block.slice(0, block.indexOf("$$") > -1 ? block.indexOf("$$") : block.length);
        if (head.includes("security definer")) {
          expect(head, `${file}: security definer without pinned search_path`).toContain("search_path");
        }
      }
    }
  });

  it("p_user_id functions granted to authenticated must guard auth.uid()", () => {
    for (const [file, sql] of sqlByFile) {
      for (const block of functionBlocks(sql)) {
        if (!block.includes("p_user_id")) continue;
        const name = block.trim().split("(")[0].trim();
        // Find the latest grant for this function name across all migrations
        // (a later migration may revoke an earlier over-broad grant).
        const grantLines = allSql
          .split("\n")
          .filter((l) => (l.includes("grant execute") || l.includes("revoke")) && l.includes(name));
        const lastAuthGrant = [...grantLines].reverse().find((l) => l.includes("authenticated"));
        const stillAuthenticated = lastAuthGrant?.includes("grant") ?? false;
        if (stillAuthenticated) {
          expect(
            block.includes("auth.uid()"),
            `${file}: ${name} takes p_user_id, is executable by authenticated, but never checks auth.uid()`
          ).toBe(true);
        }
      }
    }
  });

  it("claim_ai_generation is no longer executable by authenticated", () => {
    const h = sqlByFile.get("025_mellowa_v6_db_hardening.sql")!;
    expect(h).toContain("revoke all on function public.claim_ai_generation");
    expect(h).toMatch(/grant execute on function public\.claim_ai_generation[\s\S]*?to service_role/);
  });

  it("every created table enables row level security", () => {
    const created = new Set<string>();
    const rlsEnabled = new Set<string>();
    for (const m of allSql.matchAll(/create table if not exists public\.(\w+)/g)) created.add(m[1]);
    for (const m of allSql.matchAll(/alter table (?:if exists )?public\.(\w+)\s+enable row level security/g)) {
      rlsEnabled.add(m[1]);
    }
    // 001 enables RLS for its tables via a dynamic format() loop
    // (`alter table public.%I enable row level security`).
    for (const [, sql] of sqlByFile) {
      if (/public\.%i\s+enable row level security/.test(sql)) {
        for (const m of sql.matchAll(/create table if not exists public\.(\w+)/g)) rlsEnabled.add(m[1]);
      }
    }
    for (const t of created) {
      expect(rlsEnabled.has(t), `table ${t} never enables RLS`).toBe(true);
    }
  });

  it("statement timeouts are set per role", () => {
    const h = sqlByFile.get("025_mellowa_v6_db_hardening.sql")!;
    for (const role of ["authenticated", "anon", "service_role"]) {
      expect(h).toContain(`alter role ${role} set statement_timeout`);
    }
  });
});
