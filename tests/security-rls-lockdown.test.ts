import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration 055 contract. There is no Postgres in the test run, so this replays
 * every CREATE / DROP POLICY across all migrations in order (including the 001
 * `format()` loop) and asserts the FINAL effective policy set: an
 * `authenticated` user can no longer write billing, metering or safety state.
 */

const DIR = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
// Comments are stripped: rollback / preflight examples are not statements.
const sql = (f: string) =>
  readFileSync(join(DIR, f), "utf8").toLowerCase().replace(/--[^\n]*/g, "");
const m055 = sql("055_mellowa_security_rls_lockdown.sql");

type Cmd = "select" | "insert" | "update" | "delete" | "all";
interface Policy { table: string; cmd: Cmd; body: string }

function effectivePolicies(): Map<string, Policy> {
  const policies = new Map<string, Policy>();
  for (const f of files) {
    const text = sql(f);
    // The 001 loop: foreach t in array[...] creates %s_<cmd>_own per table.
    const loop = text.match(/foreach t in array\s*array\[([\s\S]*?)\]\s*loop([\s\S]*?)end loop/);
    if (loop) {
      const tables = [...loop[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      const cmds = [...loop[2].matchAll(/"%s_(select|insert|update|delete)_own"/g)].map((m) => m[1] as Cmd);
      for (const t of tables) for (const c of cmds) {
        policies.set(`${t}.${t}_${c}_own`, { table: t, cmd: c, body: "auth.uid() = user_id" });
      }
    }
    const stmt = /(drop policy if exists|create policy)\s+"([^"]+)"\s+on\s+public\.([a-z_]+)([\s\S]*?);/g;
    for (const m of text.matchAll(stmt)) {
      const [, kind, name, table, rest] = m;
      const key = `${table}.${name}`;
      if (kind.startsWith("drop")) policies.delete(key);
      else {
        const cmd = (rest.match(/\bfor\s+(select|insert|update|delete|all)\b/)?.[1] ?? "all") as Cmd;
        policies.set(key, { table, cmd, body: rest });
      }
    }
  }
  return policies;
}

const policies = effectivePolicies();
const cmdsOn = (table: string) =>
  [...policies.values()].filter((p) => p.table === table).map((p) => p.cmd).sort();

/** Latest CREATE OR REPLACE FUNCTION body for a function name. */
function latestFunction(name: string): string {
  let body = "";
  for (const f of files) {
    const text = sql(f);
    const re = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`, "g");
    for (const m of text.matchAll(re)) body = m[1];
  }
  return body;
}

describe("055: users cannot write billing / metering / safety state", () => {
  it("replays the 001 loop (sanity: untouched tables keep all four policies)", () => {
    expect(sql("001_initial_schema.sql")).toContain('"%s_update_own"');
    expect(cmdsOn("journal_entries")).toEqual(["delete", "insert", "select", "update"]);
  });

  it("subscriptions: authenticated can only SELECT (no insert/update/delete)", () => {
    expect(cmdsOn("subscriptions")).toEqual(["select"]);
  });

  it("ai_usage_events: no user insert (only the service-role claim writes the ledger)", () => {
    expect(cmdsOn("ai_usage_events")).toEqual(["select"]);
  });

  it("safety_events: read-only for users", () => {
    expect(cmdsOn("safety_events")).toEqual(["select"]);
  });

  it("profiles: no user insert or delete (the delete cascaded every ledger)", () => {
    expect(cmdsOn("profiles")).toEqual(["select", "update"]);
  });

  it("rows counted by the sample / weekly caps cannot be removed by the user", () => {
    expect(cmdsOn("daily_plans")).not.toContain("delete");
    expect(cmdsOn("weekly_plans")).toEqual(["insert", "select"]);
    expect(cmdsOn("wellbeing_profiles")).not.toContain("delete");
  });

  it("sample_adjustment_used_at is guarded by a trigger for anon/authenticated", () => {
    expect(m055).toMatch(/create trigger wellbeing_profiles_guard_sample_adjustment\s+before update on public\.wellbeing_profiles/);
    expect(m055).toMatch(/current_user in \('anon', 'authenticated'\)/);
  });

  it("plan_feedback / habit_logs insert+update check the parent's owner (050 pattern)", () => {
    for (const [table, parent] of [["plan_feedback", "daily_plans"], ["habit_logs", "habits"]]) {
      for (const cmd of ["insert", "update"]) {
        const p = policies.get(`${table}.${table}_${cmd}_own`);
        expect(p?.cmd).toBe(cmd);
        expect(p?.body).toContain(`from public.${parent}`);
      }
    }
  });

  it("RLS is never disabled", () => {
    for (const f of files) expect(sql(f)).not.toMatch(/disable row level security/);
  });
});

describe("055: function grants and ownership checks", () => {
  const userCallable = [
    "claim_generation_request",
    "finish_generation_request",
    "claim_daily_plan_generation",
    "finish_daily_plan_generation",
  ];

  it.each(userCallable)("%s checks ownership for every non-service role", (fn) => {
    const body = latestFunction(fn);
    expect(body).toContain("auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_user_id");
    expect(body).not.toContain("auth.role() = 'authenticated' and");
  });

  it.each(userCallable)("%s is revoked from anon", (fn) => {
    expect(m055).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
  });

  it("the daily-plan lease and stale windows are clamped", () => {
    expect(latestFunction("claim_daily_plan_generation")).toContain("least(greatest(coalesce(p_lease_seconds, 120), 1), 600)");
    expect(latestFunction("claim_generation_request")).toContain("least(greatest(coalesce(p_stale_minutes, 5), 1), 60)");
  });

  it.each([
    "claim_stripe_event(text, text)",
    "finalize_ai_usage(",
    "claim_due_emails(int, int)",
    "merge_anonymous_events(text, uuid)",
    "record_cron_run_start(text, text, text)",
    "record_cron_run_finish(uuid, text, integer, text, text)",
    "cron_job_health()",
    "readiness_schema_probe()",
    "claim_auth_rate_limit(text, int, int)",
  ])("service-role-only: %s revoked from anon and authenticated", (sig) => {
    const at = m055.indexOf(`revoke all on function public.${sig}`);
    expect(at).toBeGreaterThan(-1);
    expect(m055.slice(at, m055.indexOf(";", at))).toContain("from public, anon, authenticated");
  });

  it("claim_stripe_event only reclaims failed or stale-lease rows", () => {
    const body = latestFunction("claim_stripe_event");
    expect(body).not.toContain("status <> 'done'");
    expect(body).toContain("public.stripe_events.status = 'failed'");
    expect(body).toContain("< now() - interval '10 minutes'");
    expect(m055).toContain("add column if not exists claimed_at timestamptz");
  });
});

describe("rls-audit.sql covers the 055 lock-down", () => {
  const audit = readFileSync(join(process.cwd(), "supabase", "checks", "rls-audit.sql"), "utf8");

  it("flags any user write policy on subscriptions / ai_usage_events / safety_events", () => {
    expect(audit).toContain("user_write_policy_on_server_table");
    expect(audit).toMatch(/tablename in \('subscriptions', 'ai_usage_events', 'safety_events'\)/);
  });

  it("checks the sample guard trigger and parent-ownership policies", () => {
    expect(audit).toContain("wellbeing_profiles_guard_sample_adjustment");
    expect(audit).toContain("policy_without_parent_ownership");
  });

  it("lists the 055 functions in the anon-executable check", () => {
    for (const fn of ["claim_stripe_event", "claim_daily_plan_generation", "claim_auth_rate_limit"]) {
      expect(audit).toContain(`'${fn}'`);
    }
  });
});

describe("server-side follow-ups shipped with 055", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("trial reminders skip trials the user already cancelled", () => {
    expect(read("src/app/api/cron/trial-reminders/route.ts")).toContain('.eq("cancel_at_period_end", false)');
  });

  it("billing reconcile age-limits failed webhook events", () => {
    const src = read("src/lib/stripe/reconcile.ts");
    expect(src).toContain("and(status.eq.failed,created_at.gte.${failedWindowStart})");
  });

  it("the deleted-account email is keyed by the request id and expires", async () => {
    expect(read("src/lib/account-deletion/machine.ts")).toContain("eventKey: `account_deleted:${job.id}`");
    const { RETENTION_RULES } = await import("@/lib/privacy/registry");
    const rule = RETENTION_RULES.find((r) => "onlyTemplates" in r);
    expect(rule).toMatchObject({ table: "email_deliveries", onlyTemplates: ["account_deleted"] });
    expect(read("src/lib/privacy/retention.ts")).toContain('q.in("template"');
  });
});
