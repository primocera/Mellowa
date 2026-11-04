import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  USER_DATA_REGISTRY,
  EXEMPT_TABLES,
  RETENTION_RULES,
  exportOrderColumn,
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

/**
 * Columns per table as the migrations define them: CREATE TABLE bodies plus
 * every later `alter table ... add column`. Used to prove the export's
 * ORDER BY column (and the owner column) really exist — an ORDER BY on a
 * missing column is a PostgREST error that 500s the whole export.
 */
function columnsFromMigrations(): Map<string, Set<string>> {
  const dir = join(__dirname, "..", "supabase", "migrations");
  const cols = new Map<string, Set<string>>();
  const add = (table: string, col: string) => {
    const t = table.toLowerCase();
    if (!cols.has(t)) cols.set(t, new Set());
    cols.get(t)!.add(col.toLowerCase());
  };
  const NOT_COLUMNS = new Set([
    "primary", "unique", "constraint", "check", "foreign", "exclude", "like",
  ]);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    // Strip line comments so commented-out DDL is never counted.
    const sql = readFileSync(join(dir, file), "utf8").replace(/--[^\n]*/g, "");
    const createRe =
      /create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi;
    let m: RegExpExecArray | null;
    while ((m = createRe.exec(sql))) {
      const [, table, body] = m;
      for (const line of body.split("\n")) {
        const col = /^\s*"?(\w+)"?\s+\w/.exec(line)?.[1];
        if (col && !NOT_COLUMNS.has(col.toLowerCase())) add(table, col);
      }
    }
    const alterRe =
      /alter table (?:if exists )?(?:only )?(?:public\.)?(\w+)([\s\S]*?);/gi;
    while ((m = alterRe.exec(sql))) {
      const [, table, body] = m;
      const addRe = /add column (?:if not exists )?"?(\w+)"?/gi;
      let a: RegExpExecArray | null;
      while ((a = addRe.exec(body))) add(table, a[1]);
    }
  }
  return cols;
}

describe("privacy registry contract (Prompt 4)", () => {
  it("every registry table's export ORDER BY column (default id) exists in the migrations", () => {
    const cols = columnsFromMigrations();
    const problems: string[] = [];
    for (const entry of USER_DATA_REGISTRY) {
      const tableCols = cols.get(entry.table);
      if (!tableCols) {
        problems.push(`${entry.table}: no CREATE TABLE found in supabase/migrations`);
        continue;
      }
      const order = exportOrderColumn(entry);
      if (!tableCols.has(order)) {
        problems.push(`${entry.table}: export orders by "${order}" but the table has no such column`);
      }
      if (!tableCols.has(entry.column)) {
        problems.push(`${entry.table}: owner column "${entry.column}" does not exist`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("the tables without a surrogate id paginate by a real key column", () => {
    const byTable = new Map(USER_DATA_REGISTRY.map((e) => [e.table, e]));
    expect(exportOrderColumn(byTable.get("daily_plan_generation_claims")!)).toBe("local_date");
    expect(exportOrderColumn(byTable.get("learned_signal_suppressions")!)).toBe("signal");
    expect(exportOrderColumn(byTable.get("onboarding_completions")!)).toBe("user_id");
  });

  it("the export route paginates by the registry's order column, never a hardcoded id", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "app", "api", "account", "export", "route.ts"),
      "utf8"
    );
    expect(src).toContain("exportOrderColumn(entry)");
    expect(src).not.toMatch(/\.order\("id"/);
  });

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
