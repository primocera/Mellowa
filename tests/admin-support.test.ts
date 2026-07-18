import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_ACTIONS } from "@/lib/admin/support";
import { isAdminUserId } from "@/lib/admin/auth";

/** Support console (Launch v6, Prompt 17) — authorization + privacy gates. */

describe("admin authorization", () => {
  it("fails closed with no ADMIN_USER_IDS configured", () => {
    // serverEnv.adminUserIds is empty in the test env
    expect(isAdminUserId("11111111-1111-1111-1111-111111111111")).toBe(false);
    expect(isAdminUserId(null)).toBe(false);
  });
});

describe("actions contract", () => {
  it("only whitelisted, reversible actions exist (no delete/read-content action)", () => {
    expect([...ADMIN_ACTIONS]).toEqual([
      "view_user",
      "resend_verification",
      "replay_failed_emails",
      "flag_billing_review",
      "unflag_billing_review",
      "disable_generation",
      "enable_generation",
    ]);
  });

  it("actions route requires admin, valid action enum and a reason, and audits", () => {
    const src = readFileSync("src/app/api/admin/user-actions/route.ts", "utf8");
    expect(src).toContain("requireAdmin()");
    expect(src).toContain('z.enum(ADMIN_ACTIONS)');
    expect(src).toMatch(/reason: z\.string\(\)\.min\(3\)/);
    expect(src).toContain("recordAdminAction");
  });
});

describe("privacy of the safe overview", () => {
  it("support data layer never selects sensitive content columns", () => {
    const src = readFileSync("src/lib/admin/support.ts", "utf8");
    for (const forbidden of [
      "journal_entries",
      "daily_checkins",
      "allergies",
      "mood",
      "notes",
      "meal_cards",
      "answer",
    ]) {
      expect(
        src.toLowerCase().includes(forbidden),
        `support.ts must not touch "${forbidden}"`
      ).toBe(false);
    }
  });

  it("support console page is admin-gated and audited", () => {
    const src = readFileSync("src/app/admin/users/page.tsx", "utf8");
    expect(src).toContain("requireAdmin()");
    expect(src).toContain("notFound()");
    expect(src).toContain('action: "view_user"');
  });

  it("guard blocks generation-disabled accounts before any provider call", () => {
    const src = readFileSync("src/lib/ai/guard.ts", "utf8");
    expect(src).toContain("isGenerationDisabled");
    expect(src.indexOf("isGenerationDisabled")).toBeLessThan(src.indexOf("claimAiGeneration(userId"));
  });
});
