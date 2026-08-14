import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_ACTION_POLICY,
  BASE_ADMIN_ACTIONS,
  checkPermission,
  type AdminActionName,
} from "@/lib/admin/permissions";

/**
 * MW-V18-X07: the admin console is least-privilege. Read is the default;
 * destructive billing/deletion/generation/data-job actions require an elevated
 * role, a reason and a step-up confirmation; every admin route is guarded; and
 * the matrix covers every real action.
 */

describe("matrix coverage", () => {
  it("every base admin action has a policy", () => {
    for (const a of BASE_ADMIN_ACTIONS) {
      expect(ADMIN_ACTION_POLICY[a as AdminActionName], a).toBeTruthy();
    }
  });

  it("every destructive action requires a reason AND step-up", () => {
    for (const [action, p] of Object.entries(ADMIN_ACTION_POLICY)) {
      if (p.destructive) {
        expect(p.requiresReason, `${action} reason`).toBe(true);
        expect(p.requiresStepUp, `${action} step-up`).toBe(true);
        expect(p.minRole).not.toBe("viewer");
      }
    }
  });

  it("read is the default privilege (view_user needs nothing)", () => {
    const p = ADMIN_ACTION_POLICY.view_user;
    expect(p.destructive).toBe(false);
    expect(p.requiresStepUp).toBe(false);
    expect(p.minRole).toBe("viewer");
  });
});

describe("permission checks fail closed", () => {
  it("a viewer cannot perform a destructive action", () => {
    expect(
      checkPermission({ role: "viewer", action: "disable_generation", reason: "abuse", stepUpConfirmed: true })
    ).toEqual({ allowed: false, error: "insufficient_role" });
  });

  it("a destructive action without a reason is denied", () => {
    expect(
      checkPermission({ role: "operator", action: "flag_billing_review", stepUpConfirmed: true })
    ).toEqual({ allowed: false, error: "reason_required" });
  });

  it("a destructive action without step-up is denied", () => {
    expect(
      checkPermission({ role: "operator", action: "flag_billing_review", reason: "chargeback" })
    ).toEqual({ allowed: false, error: "step_up_required" });
  });

  it("a fully-specified operator request is allowed", () => {
    expect(
      checkPermission({ role: "operator", action: "flag_billing_review", reason: "chargeback", stepUpConfirmed: true })
    ).toEqual({ allowed: true });
  });

  it("the owner-only data job denies an operator", () => {
    expect(
      checkPermission({ role: "operator", action: "onboarding_backfill", reason: "legacy", stepUpConfirmed: true })
    ).toEqual({ allowed: false, error: "insufficient_role" });
  });

  it("an unknown action is denied", () => {
    expect(
      checkPermission({ role: "owner", action: "delete_everything" as AdminActionName })
    ).toEqual({ allowed: false, error: "unknown_action" });
  });
});

describe("every admin route is guarded", () => {
  const dir = "src/app/api/admin";
  const routes = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(dir, e.name, "route.ts"));

  for (const route of routes) {
    it(`${route} enforces admin auth or is public-safe by construction`, () => {
      const src = readFileSync(route, "utf8");
      const guarded =
        src.includes("requireAdmin") ||
        src.includes("requireBearerSecret");
      // readiness is intentionally public: it reports config PRESENCE only
      // ("ok"/"not_configured"/Boolean(...)), never a secret value or user data.
      const presenceOnly = src.includes("not_configured") || src.includes("Boolean(");
      const returnsRawSecret = /return[\s\S]{0,400}process\.env\.[A-Z_]*(SECRET|SERVICE_ROLE)/i.test(src);
      const publicSafe = /readiness/.test(route) && presenceOnly && !returnsRawSecret;
      expect(guarded || publicSafe, `${route} is neither guarded nor public-safe`).toBe(true);
    });
  }
});
