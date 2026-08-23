import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-04: deep operational readiness must cover the CURRENT product line, not
 * just legacy migrations 020/021. Every migration 044-049 subsystem has a
 * required presence/signature probe here, so a production database missing any
 * of those objects cannot report ready. Output must stay operator-safe (no
 * secrets, addresses, ids or content).
 */

const route = readFileSync("src/app/api/health/ready/route.ts", "utf8");

describe("deep readiness probes the current migration line", () => {
  const required: [string, string][] = [
    ["044 account deletion", "account_deletion_requests"],
    ["045 cohort/exclusions", "analytics_excluded_users"],
    ["046 onboarding provenance", "onboarding_completions"],
    ["047 support tickets", "support_tickets"],
    ["048 activation facts view", "analytics_activation_facts"],
    ["049 canonical daily plan", "superseded_at"],
  ];

  for (const [label, object] of required) {
    it(`probes migration ${label} (${object})`, () => {
      expect(route).toContain(object);
    });
  }

  it("has a named readiness component per required migration", () => {
    for (const key of [
      "migration_044_account_deletion",
      "migration_045_cohort_facts",
      "migration_046_onboarding_provenance",
      "migration_047_support_tickets",
      "migration_048_activation_facts",
      "migration_049_canonical_daily_plan",
    ]) {
      expect(route).toContain(key);
    }
  });

  it("probes the deletion-stats RPC signature and derives worker freshness", () => {
    expect(route).toContain("account_deletion_stats");
    expect(route).toContain("deletion_worker_freshness");
    expect(route).toContain("outbox_freshness");
    expect(route).toContain("classifyWorkerFreshness");
  });

  it("marks the migration + worker components critical and fails paid closed", () => {
    expect(route).toContain("CRITICAL");
    expect(route).toContain("resolveLaunchMode()");
    expect(route).toMatch(/summarizeReadiness\(components,\s*\{\s*mode,\s*critical:\s*CRITICAL\s*\}\)/);
  });

  it("stays operator-safe: no email/content column is selected in a probe", () => {
    // Probes select only ids, a marker column, counts or timestamps.
    expect(route).not.toMatch(/select\(["'`][^"'`]*(email|subject|body|note|content|journal)/i);
  });
});
