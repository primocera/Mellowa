import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-04 (v20): paid readiness must fail closed on missing config, exact schema
 * invariants and lenient RPC classification.
 */

// ---------------------------------------------------------------------------
// Unit contracts
// ---------------------------------------------------------------------------
describe("summarizeReadiness — paid fails closed on critical not_configured (MW-04)", () => {
  it("blocks paid when a CRITICAL config is not_configured, warns in beta", async () => {
    const { summarizeReadiness } = await import("@/lib/health");
    const comps = { config_stripe_secret_key: "not_configured" } as const;
    const critical = ["config_stripe_secret_key"];
    expect(summarizeReadiness(comps, { mode: "paid", critical }).ok).toBe(false);
    expect(summarizeReadiness(comps, { mode: "beta", critical }).ok).toBe(true);
  });

  it("a non-critical not_configured never blocks", async () => {
    const { summarizeReadiness } = await import("@/lib/health");
    expect(
      summarizeReadiness(
        { some_optional: "not_configured" },
        { mode: "paid", critical: ["database"] }
      ).ok
    ).toBe(true);
  });
});

describe("classifyRpcProbe — strict (MW-04)", () => {
  it("only the expected coercion error or a clean run is ok; faults are unavailable", async () => {
    const { classifyRpcProbe } = await import("@/lib/health");
    expect(classifyRpcProbe(null)).toBe("ok");
    expect(classifyRpcProbe({ code: "22P02" })).toBe("ok");
    expect(classifyRpcProbe({ code: "PGRST202" })).toBe("fail");
    // permission denied / timeout / transport → not observed as healthy
    expect(classifyRpcProbe({ code: "42501", message: "permission denied" })).toBe("unavailable");
    expect(classifyRpcProbe({ code: "57014", message: "statement timeout" })).toBe("unavailable");
    expect(classifyRpcProbe({ message: "fetch failed" })).toBe("unavailable");
  });
});

describe("paid config contract parity (MW-04)", () => {
  it("every paid-readiness config var is required by release-check", async () => {
    const { PAID_READINESS_CONFIG, REQUIRED_ENV, PAID_LAUNCH_ENV } = await import(
      "@/lib/health/paid-config"
    );
    const declared = new Set([...REQUIRED_ENV, ...PAID_LAUNCH_ENV]);
    for (const v of PAID_READINESS_CONFIG) expect(declared.has(v)).toBe(true);
  });

  it("covers the Stripe/AI/cron/email/legal families", async () => {
    const { PAID_READINESS_CONFIG } = await import("@/lib/health/paid-config");
    for (const v of [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_PRO_MONTHLY",
      "STRIPE_PRICE_PRO_YEARLY",
      "AI_PROVIDER_API_KEY",
      "CRON_SECRET",
      "RESEND_API_KEY",
      "LEGAL_ENTITY_NAME",
    ]) {
      expect(PAID_READINESS_CONFIG).toContain(v);
    }
  });

  it("the release-check script sources the same canonical contract", () => {
    const script = readFileSync("scripts/release-check.mjs", "utf8");
    expect(script).toContain("paid-required-env.json");
    expect(script).toContain("CONTRACT.requiredEnv");
  });
});

describe("readiness route probes the exact schema invariants (MW-04)", () => {
  it("calls readiness_schema_probe and treats the invariants as critical", () => {
    const route = readFileSync("src/app/api/health/ready/route.ts", "utf8");
    expect(route).toContain("readiness_schema_probe");
    expect(route).toContain("schema_daily_plans_canonical_index");
    expect(route).toContain("schema_plan_completions_parent_ownership");
    expect(route).toContain("paidConfigComponentKeys");
  });

  it("migration 052 checks the partial unique index predicate and the ownership policy", () => {
    const sql = readFileSync(
      "supabase/migrations/052_mellowa_v20_readiness_schema_probe.sql",
      "utf8"
    );
    expect(sql).toMatch(/daily_plans_user_date_canonical/);
    expect(sql).toMatch(/superseded_at is null/);
    expect(sql).toMatch(/pg_policies[\s\S]*plan_completions[\s\S]*daily_plans/);
  });
});

// ---------------------------------------------------------------------------
// Route integration: mocked admin client + env
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  schemaAllTrue: true,
  schemaError: null as { code?: string; message?: string } | null,
}));

function healthyAdmin() {
  const table = () => {
    const api: Record<string, unknown> = {
      select: () => api,
      limit: async () => ({ error: null, count: 0 }),
      eq: async () => ({ error: null, count: 0 }),
      in: () => api,
      order: () => api,
    };
    // support `.select(...).eq(...)` (await) and `.select(...).in(...).order(...).limit()`
    (api as Record<string, unknown>).then = undefined;
    return api;
  };
  return {
    from: () => table(),
    rpc: async (name: string) => {
      if (name === "readiness_schema_probe") {
        if (h.schemaError) return { data: null, error: h.schemaError };
        const v = h.schemaAllTrue;
        return {
          data: {
            daily_plans_canonical_index: v,
            plan_completions_parent_ownership: v,
            daily_plan_claims_table: v,
            claim_daily_plan_fn: v,
            finish_daily_plan_fn: v,
          },
          error: null,
        };
      }
      if (name === "account_deletion_stats")
        return { data: { stuck_jobs: 0, oldest_open: null }, error: null };
      if (name === "cron_job_health") {
        const nowIso = new Date().toISOString();
        return {
          data: [
            { job_id: "retention", last_success_at: nowIso, last_failure_at: null, last_status: "success", last_run_at: nowIso },
            { job_id: "billing-reconcile", last_success_at: nowIso, last_failure_at: null, last_status: "success", last_run_at: nowIso },
          ],
          error: null,
        };
      }
      // claim_ai_generation / undo_plan_repair: expected coercion error
      return { data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } };
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => healthyAdmin(),
}));

import { GET } from "@/app/api/health/ready/route";

function req() {
  return new Request("http://t/api/health/ready", {
    headers: { authorization: "Bearer test-admin-secret" },
  });
}

const ALL_CONFIG = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_PRICE_PRO_MONTHLY: "price_m",
  STRIPE_PRICE_PRO_YEARLY: "price_y",
  AI_PROVIDER_API_KEY: "ai_x",
  CRON_SECRET: "cron_x",
  ADMIN_STATS_SECRET: "test-admin-secret",
  RESEND_API_KEY: "re_x",
  EMAIL_FROM: "hi@mellowa.app",
  LEGAL_ENTITY_NAME: "Mellowa d.o.o.",
  LEGAL_REGISTERED_ADDRESS: "Somewhere",
  LEGAL_GOVERNING_LAW: "SI",
  SUPPORT_EMAIL: "support@mellowa.app",
};

beforeEach(() => {
  h.schemaAllTrue = true;
  h.schemaError = null;
  for (const [k, v] of Object.entries(ALL_CONFIG)) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/health/ready — paid mode fail-closed (MW-04)", () => {
  it("200 in paid mode when all config + schema are present", async () => {
    vi.stubEnv("READINESS_MODE", "paid");
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("503 in paid mode when a Stripe config is missing", async () => {
    vi.stubEnv("READINESS_MODE", "paid");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBe(false);
  });

  it("200 in BETA mode even with a Stripe config missing (not_configured allowed)", async () => {
    vi.stubEnv("READINESS_MODE", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await GET(req());
    expect(res.status).toBe(200);
  });

  it("503 in BOTH modes when the canonical unique index is absent", async () => {
    h.schemaAllTrue = false; // index/policy missing
    vi.stubEnv("READINESS_MODE", "paid");
    expect((await GET(req())).status).toBe(503);
    vi.stubEnv("READINESS_MODE", "");
    expect((await GET(req())).status).toBe(503);
  });

  it("503 when the schema probe function itself is missing", async () => {
    h.schemaError = { code: "PGRST202", message: "could not find the function" };
    vi.stubEnv("READINESS_MODE", "paid");
    expect((await GET(req())).status).toBe(503);
  });
});
