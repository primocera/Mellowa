import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-05 (v20): the shared cron helper records a durable run and enforces the
 * registry-declared lease with an explicit failure policy.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  leaseResult: true as boolean, // claim_cron_run return
  leaseError: null as Row | null,
  starts: [] as Row[],
  finishes: [] as Row[],
  handlerRuns: 0,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Row) => {
      if (name === "claim_cron_run") return { data: h.leaseResult, error: h.leaseError };
      if (name === "release_cron_run") return { data: null, error: null };
      if (name === "record_cron_run_start") {
        h.starts.push(args);
        return { data: "ledger-1", error: null };
      }
      if (name === "record_cron_run_finish") {
        h.finishes.push(args);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
  }),
}));

import { runCronJob } from "@/lib/ops/run-cron-job";

beforeEach(() => {
  h.leaseResult = true;
  h.leaseError = null;
  h.starts = [];
  h.finishes = [];
  h.handlerRuns = 0;
});

const handler = () => {
  h.handlerRuns += 1;
  return Promise.resolve({ processed: 5 });
};

describe("runCronJob (MW-05)", () => {
  it("unknown job id throws (no route can bypass the registry)", async () => {
    await expect(runCronJob("not-a-job", handler)).rejects.toThrow(/unknown job/i);
  });

  it("success: records start + success, runs handler once", async () => {
    const out = await runCronJob("retention", handler, { leaseFailurePolicy: "fail_closed" });
    expect(out.status).toBe("success");
    expect(out.processed).toBe(5);
    expect(h.handlerRuns).toBe(1);
    expect(h.starts).toHaveLength(1);
    expect(h.finishes[0].p_status).toBe("success");
  });

  it("handler ok:false → failure with a safe category", async () => {
    const out = await runCronJob("retention", () =>
      Promise.resolve({ processed: 1, ok: false, errorCategory: "partial_purge_failure" })
    );
    expect(out.status).toBe("failure");
    expect(h.finishes[0].p_status).toBe("failure");
    expect(h.finishes[0].p_error_category).toBe("partial_purge_failure");
  });

  it("thrown error → failure, categorized, never leaks the message", async () => {
    const out = await runCronJob("retention", () => {
      throw new Error("connection to database relation timed out at 10.0.0.1");
    });
    expect(out.status).toBe("failure");
    // A coarse category, not the raw message.
    expect(["timeout", "db_error", "job_error"]).toContain(h.finishes[0].p_error_category);
    expect(JSON.stringify(h.finishes)).not.toContain("10.0.0.1");
  });

  it("lease held by another run → skipped_locked, handler NOT called", async () => {
    h.leaseResult = false;
    const out = await runCronJob("retention", handler, { leaseFailurePolicy: "fail_closed" });
    expect(out.status).toBe("skipped_locked");
    expect(h.handlerRuns).toBe(0);
    expect(h.finishes[0].p_status).toBe("skipped_locked");
  });

  it("fail_closed job whose lease cannot be evaluated → lease_unavailable, handler NOT called", async () => {
    h.leaseError = { message: "db down" }; // acquireCronLease fails OPEN (evaluated:false)
    const out = await runCronJob("billing-reconcile", handler, {
      leaseFailurePolicy: "fail_closed",
    });
    expect(out.status).toBe("lease_unavailable");
    expect(h.handlerRuns).toBe(0);
    expect(h.finishes[0].p_status).toBe("lease_unavailable");
  });

  it("proceed policy runs even when the lease cannot be evaluated (idempotent job)", async () => {
    h.leaseError = { message: "db down" };
    const out = await runCronJob("retention", handler, { leaseFailurePolicy: "proceed" });
    expect(out.status).toBe("success");
    expect(h.handlerRuns).toBe(1);
  });
});

describe("MW-05 wiring + migration source", () => {
  it("retention and billing-reconcile routes run through the shared helper (real lease)", () => {
    for (const p of [
      "src/app/api/cron/retention/route.ts",
      "src/app/api/cron/billing-reconcile/route.ts",
    ]) {
      const src = readFileSync(p, "utf8");
      expect(src).toContain("runCronJob");
      expect(src).toContain("fail_closed");
    }
  });

  it("migration 053 defines the cron_runs ledger + health function", () => {
    const sql = readFileSync("supabase/migrations/053_mellowa_v20_cron_runs_ledger.sql", "utf8");
    expect(sql).toMatch(/create table if not exists public\.cron_runs/);
    expect(sql).toMatch(/record_cron_run_start/);
    expect(sql).toMatch(/record_cron_run_finish/);
    expect(sql).toMatch(/cron_job_health/);
  });

  it("readiness consumes the ledger for the external-pinger jobs", () => {
    const src = readFileSync("src/app/api/health/ready/route.ts", "utf8");
    expect(src).toContain("cron_job_health");
    expect(src).toContain("cron_retention_freshness");
    expect(src).toContain("cron_billing_reconcile_freshness");
  });
});
