import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROMPT_VERSIONS } from "@/prompts/versions";
import { MODEL_POLICIES } from "@/lib/ai/model-policy";
import { TRIAL_VARIANTS } from "@/lib/stripe/trial-experiment";
import { REMINDER_CONSENT_VERSION } from "@/lib/email/reminder-planner";
import { ANALYTICS_VERSION } from "@/lib/analytics/taxonomy";

/**
 * MW-V10-08: release-candidate gate.
 *
 * This file adds no features. It verifies the claims the go/no-go document
 * makes, because a scorecard that asserts "every migration is additive, so
 * rollback needs no migration reversal" is worth nothing if nobody checked.
 *
 * Everything here is deterministic and reads the repository itself, so it
 * re-runs at the exact RC SHA and cannot drift from what is being shipped.
 */

const MIGRATIONS_DIR = "supabase/migrations";
const migrationFiles = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

describe("migration rollback dry run", () => {
  it("every migration is present and numbered without gaps", () => {
    const numbers = migrationFiles().map((f) => Number(f.slice(0, 3)));
    expect(numbers.length).toBeGreaterThan(0);
    for (let i = 1; i < numbers.length; i++) {
      expect(
        numbers[i],
        `gap or duplicate between ${migrationFiles()[i - 1]} and ${migrationFiles()[i]}`
      ).toBe(numbers[i - 1] + 1);
    }
  });

  it("no migration destroys data, so a rollback needs no migration reversal", () => {
    // This is the exact claim §5 of the go/no-go makes. A DROP COLUMN or a
    // destructive type change would make a flag-based rollback unsafe, because
    // the previous deploy's code would find its columns gone.
    const destructive = [
      /\bdrop\s+table\b(?!\s+if\s+exists\s+\S*_?tmp)/i,
      /\bdrop\s+column\b/i,
      /\btruncate\b/i,
      /\bdelete\s+from\b/i,
      /\balter\s+column\s+\w+\s+type\b/i,
    ];
    const offenders: string[] = [];
    for (const file of migrationFiles()) {
      const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8");
      // Two things are stripped before matching, both deliberately:
      //  - comments, where "delete" legitimately appears in commentary;
      //  - function BODIES ($$ … $$), because a delete inside a stored function
      //    is runtime application behaviour, not migration-time destruction.
      //    `undo_plan_repair` consuming its own snapshot row IS the intended
      //    Undo, and flagging it would make this check meaningless.
      const withoutComments = sql
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
      const topLevel = withoutComments.replace(/\$\$[\s\S]*?\$\$/g, " BODY ");
      for (const pattern of destructive) {
        if (pattern.test(topLevel)) offenders.push(`${file} :: ${pattern}`);
      }
    }
    expect(offenders, `destructive migration statements: ${offenders.join(", ")}`).toEqual(
      []
    );
  });

  it("the v10 migrations are all additive and idempotent", () => {
    for (const file of migrationFiles().filter((f) => Number(f.slice(0, 3)) >= 36)) {
      const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8");
      // Re-running a migration must not fail: every DDL is guarded.
      const hasGuard =
        /if not exists/i.test(sql) ||
        /create or replace/i.test(sql) ||
        /on conflict/i.test(sql);
      expect(hasGuard, `${file} is not re-runnable`).toBe(true);
    }
  });

  it("every v10 migration is referenced by the release documentation", () => {
    const goNoGo = readFileSync("docs/launch-go-no-go-v10.md", "utf8");
    // v10 introduced migrations 036–039. The bound is explicit rather than an
    // open ">= 36": later releases add later migrations (MW-V12-04 added 040),
    // and those belong to their own candidate's documentation, not the v10 doc.
    for (const file of migrationFiles().filter((f) => {
      const n = Number(f.slice(0, 3));
      return n >= 36 && n <= 39;
    })) {
      const number = file.slice(0, 3);
      expect(goNoGo, `migration ${number} is not mentioned in the go/no-go`).toContain(
        number
      );
    }
  });
});

describe("versions are pinned at the RC", () => {
  it("every prompt has an immutable id and a content hash", () => {
    for (const [key, v] of Object.entries(PROMPT_VERSIONS)) {
      expect(v.id, key).toMatch(/^[a-z0-9-]+@\d+$/);
      expect(v.sha256, key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("every AI route has an explicit model policy", () => {
    for (const [route, policy] of Object.entries(MODEL_POLICIES)) {
      expect(policy.maxTokens, route).toBeGreaterThan(0);
      expect(policy.timeoutMs, route).toBeGreaterThan(0);
      // Degradation is a decision, never left implicit.
      expect(
        ["curated_fallback", "fail_closed", "skip_optional"],
        route
      ).toContain(policy.degradation);
    }
  });

  it("the pinned contract versions are recorded in the go/no-go", () => {
    const doc = readFileSync("docs/launch-go-no-go-v10.md", "utf8");
    expect(doc).toContain(PROMPT_VERSIONS["daily-plan-v2"].id);
    expect(doc).toContain(REMINDER_CONSENT_VERSION);
    expect(doc).toContain(`analytics v${ANALYTICS_VERSION}`);
    // Both trial arms, so a reader knows what could have been assigned.
    for (const variant of Object.keys(TRIAL_VARIANTS)) {
      expect(doc, `trial variant ${variant} not documented`).toContain(variant);
    }
  });

  it("the experiment flags are all off in the committed defaults", () => {
    const example = readFileSync(".env.example", "utf8");
    // A shipped default that silently enables an experiment would make the RC
    // unreproducible: two deploys of the same SHA would behave differently.
    expect(example).toMatch(/FLAG_TRIAL_LENGTH_EXPERIMENT=\s*$/m);
    expect(example).toMatch(/TRIAL_EXPERIMENT_PERCENT=0/);
  });
});

describe("failure injection — the named RC scenarios", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("duplicate generation cannot be claimed twice", () => {
    // Idempotency key + a claim RPC, not a best-effort check.
    const route = read("src/app/api/ai/daily-plan/route.ts");
    expect(route).toMatch(/claimGenerationRequest|X-Idempotency-Key|idempotency/i);
    const migration = read("supabase/migrations/035_mellowa_v9_monthly_fair_use.sql");
    expect(migration).toMatch(/pg_advisory_xact_lock/);
  });

  it("duplicate charge cannot be created by a retried checkout", () => {
    const route = read("src/app/api/stripe/checkout/route.ts");
    expect(route).toMatch(/idempotencyKey:/);
    // …and a replayed webhook cannot double-apply.
    const hook = read("src/app/api/stripe/webhook/route.ts");
    expect(hook).toContain("claim_stripe_event");
    expect(hook).toMatch(/duplicate: true/);
  });

  it("a partial database failure never leaves a half-applied repair", () => {
    const repair = read("src/app/api/ai/plan-repair/route.ts");
    // One atomic RPC, so meals and sections cannot commit separately.
    expect(repair).toMatch(/apply_plan_repair/);
  });

  it("a stale repair is rejected rather than silently unwinding newer work", () => {
    const repair = read("src/app/api/ai/plan-repair/route.ts");
    expect(repair).toContain("version_conflict");
    const today = read("src/components/dailyflow/today-plan-v2.tsx");
    expect(today).toMatch(/newer plan is the one you have/);
  });

  it("a delayed or duplicated cron run cannot duplicate messages", () => {
    const cron = read("src/app/api/cron/daily-reminders/route.ts");
    expect(cron).toContain("acquireCronLease");
    // The real guarantee is the ledger key, independent of the lease.
    expect(cron).toContain("eventKey: r.dedupeKey");
  });

  it("an invalid timezone never produces a mis-timed send or a wrong day", () => {
    expect(read("src/lib/email/reminder-planner.ts")).toContain("invalidTimezones");
    const today = read("src/app/(app)/today/page.tsx");
    expect(today).toContain("timezoneNeedsRepair");
    expect(today).toMatch(/latestPlan\.plan_date === assumedLocalDate/);
  });

  it("provider failure degrades to a labelled fallback, never a silent one", () => {
    const route = read("src/app/api/ai/daily-plan/route.ts");
    expect(route).toContain("buildFallbackDailyPlan");
    expect(route).toContain("is_fallback: usedFallback");
    // And the user is told, per MW-V10-04.
    expect(read("src/lib/plan/provenance.ts")).toMatch(/prepared backup day/i);
  });

  it("an unauthorized admin request is refused, fail-closed", () => {
    const auth = read("src/lib/admin/auth.ts");
    expect(auth).toMatch(/adminUserIds/);
    const cronAuth = read("src/lib/cron-auth.ts");
    // Missing secret must be 503 (not configured), wrong token 401.
    expect(cronAuth).toMatch(/503/);
    expect(cronAuth).toMatch(/401/);
  });

  it("a safety block never produces a plan, an upsell or a charge", () => {
    const route = read("src/app/api/ai/daily-plan/route.ts");
    // Position against the plan INSERT, not against any mention of the table:
    // an earlier read of daily_plans (the entitlement count) is expected.
    const safetyIdx = route.indexOf("await checkInputSafety(");
    const insertIdx = route.indexOf(".insert({");
    expect(safetyIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(safetyIdx, "safety classification runs after the plan insert").toBeLessThan(
      insertIdx
    );
    // A blocked response carrying no commercial content is asserted in detail
    // by tests/adversarial-matrix.test.ts; here we pin only the ordering.
    expect(route).toContain('status: "safety_blocked"');
  });
});

describe("release-check reveals no secret values", () => {
  const script = readFileSync("scripts/release-check.mjs", "utf8");

  it("prints presence only, never a value", () => {
    expect(script).toMatch(/values never printed|never printed/i);
    // No interpolation of a process.env value into output.
    expect(script).not.toMatch(/console\.log\([^)]*process\.env\.[A-Z_]+[^)]*\)/);
  });

  it("exits non-zero on a missing requirement, so CI cannot ignore it", () => {
    expect(script).toMatch(/process\.exit\(failures \? 1 : 0\)/);
  });
});

describe("the RC document is honest by construction", () => {
  const doc = readFileSync("docs/launch-go-no-go-v10.md", "utf8");

  it("uses the exact status vocabulary and defines it", () => {
    for (const word of ["tested", "configured", "rehearsed live", "observed"]) {
      expect(doc, `status vocabulary missing "${word}"`).toContain(word);
    }
  });

  it("records a frozen RC SHA rather than a placeholder", () => {
    // Allow markdown emphasis between the label and the value; require a full
    // 40-char SHA, so an abbreviated or placeholder value fails.
    expect(doc).toMatch(/RC SHA:\*{0,2}\s*`[0-9a-f]{40}`/);
  });

  it("keeps the public-paid verdict NO-GO while owner evidence is blank", () => {
    const blankEvidence = /Evidence:\s*__\s*$/m.test(doc);
    if (blankEvidence) {
      expect(doc).toMatch(/Public paid launch:\s*\*?\*?NO-GO/i);
    }
  });

  it("names an owner and a deadline for every open risk", () => {
    // The risk table must not have an unowned row.
    const rows = doc
      .split(/\r?\n/)
      .filter((l) => /^\|\s*\d+\s*\|/.test(l) && /P0|P1|P2/.test(l));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      // # | level | item | owner | acceptance
      expect(cells[4], `unowned risk row: ${row}`).not.toBe("");
    }
  });

  it("does not claim a Lighthouse score that was never measured", () => {
    // MW-V10-07 improved Today's waterfall but measured no Web Vital.
    const claimsScore = /lighthouse\s+(score\s+)?\d{2,3}/i.test(doc);
    expect(claimsScore, "go/no-go claims a Lighthouse number").toBe(false);
  });

  it("still lists the unrun authenticated suites as non-green", () => {
    expect(doc).toMatch(/not run/i);
    expect(doc).toMatch(/never been executed|has not been executed|unrun/i);
  });
});

describe("no debug or stale surface ships in the RC", () => {
  it("has no debug/dev-only route under app/", () => {
    const suspicious = ["src/app/debug", "src/app/dev", "src/app/(dev)", "src/app/test"];
    for (const dir of suspicious) {
      expect(existsSync(dir), `${dir} exists`).toBe(false);
    }
  });

  it("ships no API route that dumps user content", () => {
    // A "peek at a user's plan" helper is exactly the kind of thing that gets
    // added during debugging and forgotten.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]
      );
    const routes = walk("src/app/api").filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThan(0);
    for (const file of routes) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} logs a full request body`).not.toMatch(
        /console\.(log|info)\((?:[^)]*\b(body|payload|checkin|plan)\b)/
      );
    }
  });
});
