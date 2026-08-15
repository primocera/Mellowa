import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * XAPP-02 (v19): the final adversarial sweep must confirm the v19 changes leaked
 * no secret, address, health/content or full email into logs, and that the new
 * data location (migration 049's daily_plans.superseded_at marker) is covered by
 * the existing privacy contract (it is a column on an already-registered table).
 * Broad security/a11y/resilience coverage lives in the established suites; this
 * guards the v19 delta specifically.
 */

const V19_SERVER_FILES = [
  "src/lib/today/mutation-guard.ts",
  "src/app/api/ai/daily-plan/route.ts",
  "src/app/api/ai/plan-repair/route.ts",
  "src/app/api/ai/regenerate-section/route.ts",
  "src/app/api/week/reflection/route.ts",
  "src/lib/email/deliver.ts",
  "src/lib/observability/report.ts",
  "src/lib/analytics/report.ts",
  "src/app/api/health/ready/route.ts",
  "src/app/api/admin/support-tickets/route.ts",
];

describe("v19 changes leak nothing sensitive into logs", () => {
  for (const file of V19_SERVER_FILES) {
    const src = readFileSync(file, "utf8");
    it(`${file} logs no literal email address`, () => {
      // No console.* that embeds a literal name@domain.tld.
      expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    });
    it(`${file} logs no obvious wellbeing/plan content field`, () => {
      // A log line must not interpolate check-in/journal/meal free text.
      expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*\b(journal|checkin_notes|meal_cards|today_focus|body|subject)\b/);
    });
  }
});

describe("migration 049 adds no unregistered user-data table", () => {
  it("only alters daily_plans (already privacy-registered) — no new create table", () => {
    const mig = readFileSync(
      "supabase/migrations/049_mellowa_v19_canonical_daily_plan.sql",
      "utf8"
    );
    expect(mig).not.toMatch(/create table/i);
    expect(mig).toMatch(/alter table public\.daily_plans/i);
  });
});

describe("dependency posture is recorded for the candidate", () => {
  it("the release sweep records a zero-vulnerability production audit", () => {
    const doc = readFileSync("docs/release/v19/XAPP-02-release-sweep.md", "utf8");
    expect(doc).toMatch(/0 vulnerabilities|zero-vulnerability/i);
  });
});
