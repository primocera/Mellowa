import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  USER_DATA_REGISTRY,
  EXEMPT_TABLES,
  RETENTION_RULES,
} from "@/lib/privacy/registry";

/**
 * Migration contract (Prompt 4): every table a migration creates with a
 * user-linked column must appear in the privacy registry (or be explicitly
 * exempted with a reason). This makes it impossible to add user-owned data
 * that export/deletion silently misses.
 */
function tablesFromMigrations(): string[] {
  const dir = join(__dirname, "..", "supabase", "migrations");
  const tables = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, file), "utf8");
    const createRe =
      /create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi;
    let m: RegExpExecArray | null;
    while ((m = createRe.exec(sql))) {
      const [, table, body] = m;
      const hasUserLink =
        /\buser_id uuid/i.test(body) ||
        /\bid uuid .*references auth\.users/i.test(body);
      if (hasUserLink) tables.add(table);
    }
  }
  return [...tables];
}

describe("privacy registry contract (Prompt 4)", () => {
  it("covers every user-linked table created by migrations", () => {
    const registered = new Set(USER_DATA_REGISTRY.map((t) => t.table));
    const exempt = new Set(EXEMPT_TABLES.map((t) => t.table));
    const missing = tablesFromMigrations().filter(
      (t) => !registered.has(t) && !exempt.has(t)
    );
    expect(
      missing,
      `User-linked tables missing from USER_DATA_REGISTRY (add them or exempt with a reason): ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("includes the tables the v5 audit flagged as omitted", () => {
    const tables = USER_DATA_REGISTRY.map((t) => t.table);
    for (const required of [
      "favourite_meals",
      "plan_feedback",
      "app_events",
      "profiles",
      "subscriptions",
      "email_deliveries",
    ]) {
      expect(tables).toContain(required);
    }
  });

  it("every exemption documents a reason", () => {
    for (const e of EXEMPT_TABLES) {
      expect(e.reason.length).toBeGreaterThan(10);
    }
  });

  it("retention rules are defined for safety, analytics and email data", () => {
    const ruled = RETENTION_RULES.map((r) => r.table);
    expect(ruled).toContain("safety_events");
    expect(ruled).toContain("app_events");
    expect(ruled).toContain("email_deliveries");
    for (const r of RETENTION_RULES) {
      expect(r.days).toBeGreaterThan(0);
      expect(r.reason.length).toBeGreaterThan(5);
    }
  });
});
