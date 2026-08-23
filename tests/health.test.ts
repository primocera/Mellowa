import { describe, expect, it } from "vitest";
import {
  releaseVersion,
  summarizeReadiness,
  classifyWorkerFreshness,
  readinessMode,
} from "@/lib/health";

describe("readiness summary (v6 Prompt 5)", () => {
  it("is ok when everything is ok or merely unconfigured", () => {
    expect(
      summarizeReadiness({ database: "ok", stripe_config: "not_configured" }).ok
    ).toBe(true);
  });

  it("fails when any component fails", () => {
    expect(
      summarizeReadiness({ database: "fail", email_config: "ok" }).ok
    ).toBe(false);
  });

  it("reports a short release version and never a secret", () => {
    expect(
      releaseVersion({ VERCEL_GIT_COMMIT_SHA: "abcdef1234567890" })
    ).toBe("abcdef1");
    expect(releaseVersion({})).toBe("dev");
  });
});

describe("MW-04: beta vs paid readiness modes", () => {
  const critical = ["migration_047_support_tickets", "deletion_worker_freshness"];

  it("a missing required object (fail) blocks readiness in BOTH modes", () => {
    const comps = { migration_047_support_tickets: "fail" } as const;
    expect(summarizeReadiness(comps, { mode: "beta", critical }).ok).toBe(false);
    expect(summarizeReadiness(comps, { mode: "paid", critical }).ok).toBe(false);
  });

  it("a degraded critical worker is warn-only in beta but fails closed in paid", () => {
    const comps = { deletion_worker_freshness: "degraded" } as const;
    expect(summarizeReadiness(comps, { mode: "beta", critical }).ok).toBe(true);
    expect(summarizeReadiness(comps, { mode: "paid", critical }).ok).toBe(false);
  });

  it("an unavailable critical component is not treated as healthy in paid", () => {
    const comps = { deletion_worker_freshness: "unavailable" } as const;
    expect(summarizeReadiness(comps, { mode: "beta", critical }).ok).toBe(true);
    expect(summarizeReadiness(comps, { mode: "paid", critical }).ok).toBe(false);
  });

  it("not_configured never blocks, and non-critical degraded never blocks paid", () => {
    expect(
      summarizeReadiness(
        { stripe_config: "not_configured", some_optional: "degraded" },
        { mode: "paid", critical }
      ).ok
    ).toBe(true);
  });

  it("mode is echoed back only when provided (backwards compatible)", () => {
    expect(summarizeReadiness({ database: "ok" }).mode).toBeUndefined();
    expect(summarizeReadiness({ database: "ok" }, { mode: "paid" }).mode).toBe("paid");
  });

  it("readinessMode derives from the canonical LAUNCH_MODE (WS-C)", () => {
    // Dev default is beta; paid is opt-in via the canonical variable.
    expect(readinessMode({})).toBe("beta");
    expect(readinessMode({ LAUNCH_MODE: "paid" })).toBe("paid");
    expect(readinessMode({ LAUNCH_MODE: "beta" })).toBe("beta");
    // The deprecated READINESS_MODE alone no longer drives the mode — LAUNCH_MODE
    // is the single source of truth (mismatch/misconfig is reported via
    // resolveLaunchMode().ok, exercised in launch-mode-parity.test.ts).
    expect(readinessMode({ READINESS_MODE: "paid" })).toBe("beta");
    // A production deployment without a valid mode gates as paid (strictest) and
    // is flagged as a misconfiguration rather than silently running as beta.
    expect(readinessMode({ NODE_ENV: "production" })).toBe("paid");
  });
});

describe("MW-04: worker freshness classification (counts only)", () => {
  const now = Date.parse("2026-08-15T12:00:00Z");
  it("ok when no stuck/dead jobs and nothing overdue", () => {
    expect(classifyWorkerFreshness({ stuckOrDead: 0, oldestDueMs: null, now })).toBe("ok");
    expect(
      classifyWorkerFreshness({ stuckOrDead: 0, oldestDueMs: now - 60_000, now })
    ).toBe("ok");
  });
  it("degraded when a job is stuck or dead-lettered", () => {
    expect(classifyWorkerFreshness({ stuckOrDead: 1, oldestDueMs: null, now })).toBe("degraded");
  });
  it("degraded when the oldest due item is older than the backlog tolerance", () => {
    expect(
      classifyWorkerFreshness({
        stuckOrDead: 0,
        oldestDueMs: now - 7 * 60 * 60 * 1000, // 7h > 6h default
        now,
      })
    ).toBe("degraded");
  });
});
