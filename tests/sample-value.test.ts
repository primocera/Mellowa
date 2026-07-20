import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "@/lib/stripe/plans";
import {
  SERVER_AUTHORITATIVE_EVENTS,
  CLIENT_EVENTS,
} from "@/lib/analytics/taxonomy";

/**
 * MW-S07: the free sample demonstrates the value loop once — one daily plan
 * plus one bounded non-AI adjustment — with the sample/trial boundary honest
 * on every surface.
 */

const regen = readFileSync("src/app/api/ai/regenerate-section/route.ts", "utf8");
const today = readFileSync("src/components/dailyflow/today-plan-v2.tsx", "utf8");
const checkin = readFileSync("src/app/(app)/check-in/page.tsx", "utf8");

describe("sample adjustment entitlement", () => {
  it("is defined once in the canonical plan limits", () => {
    expect(PLAN_LIMITS.sample.sampleAdjustmentsTotal).toBe(1);
  });

  it("meal regeneration (a provider call) stays Premium-only", () => {
    const sampleBlock = regen.slice(
      regen.indexOf("if (!sub.isPremium)"),
      regen.indexOf("sampleAdjustment = true")
    );
    expect(sampleBlock).toContain('section_name === "meal_card"');
    expect(sampleBlock).toContain("premium_required");
  });

  it("the one-lifetime claim is an atomic conditional update", () => {
    expect(regen).toContain('.is("sample_adjustment_used_at", null)');
    expect(regen).toContain("sample_adjustment_used");
  });

  it("failed or blocked requests refund the sample allowance", () => {
    expect(regen).toContain("refundSampleAdjustment");
    // Refund on safety block, plan-not-found and save failure.
    const blockIdx = regen.indexOf("should_block_generation");
    expect(regen.indexOf("refundSampleAdjustment()", blockIdx)).toBeGreaterThan(-1);
  });

  it("the value action event is server-confirmed only after a saved swap", () => {
    const savedIdx = regen.indexOf("curatedError");
    const eventIdx = regen.indexOf("sample_value_action_completed");
    expect(eventIdx).toBeGreaterThan(savedIdx);
    expect(SERVER_AUTHORITATIVE_EVENTS.has("sample_value_action_completed")).toBe(true);
    expect(CLIENT_EVENTS.has("premium_value_explained")).toBe(true);
  });
});

describe("sample/trial boundary copy", () => {
  it("check-in discloses the exact sample allowance before generation", () => {
    expect(checkin).toContain("your one free sample plan");
    expect(checkin).toMatch(/includes one adjustment/i);
    expect(checkin).toMatch(/no payment method/i);
  });

  it("entitlement copy names only implemented Premium capabilities", () => {
    const msg = today.slice(
      today.indexOf("function entitlementMessage"),
      today.indexOf("function newAttemptKey")
    );
    expect(msg).toMatch(/daily adjustments|meal planning|weekly continuity/);
    expect(msg).not.toMatch(/unlimited|coach|therapy|health outcomes?/i);
  });

  it("never promises a trial or 'no card' outside the sample", () => {
    const msg = today.slice(
      today.indexOf("function entitlementMessage"),
      today.indexOf("function newAttemptKey")
    );
    expect(msg).not.toMatch(/3 days|free trial|no card/i);
  });

  it("preserves what the user created — no lockout language", () => {
    expect(today).toMatch(/stays readable|yours to keep/);
  });
});
