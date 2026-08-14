import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldShowPaywall, checkPaywallCopy } from "@/lib/paywall/gating";

/**
 * MW-V18-16: paywalls appear only after experienced value and never to users
 * with access or of unknown entitlement; copy is free of dark patterns. No
 * billing code involved.
 */

describe("paywall timing", () => {
  it("shows only after experienced value, to a free user", () => {
    expect(shouldShowPaywall({ entitlement: "free", experiencedValue: true }).show).toBe(true);
  });

  it("never before the user experiences value", () => {
    expect(shouldShowPaywall({ entitlement: "free", experiencedValue: false }).show).toBe(false);
  });

  it("never to a user who already has access", () => {
    expect(shouldShowPaywall({ entitlement: "premium", experiencedValue: true }).show).toBe(false);
    expect(shouldShowPaywall({ entitlement: "trialing", experiencedValue: true }).show).toBe(false);
  });

  it("fails closed on unknown entitlement (no pressure)", () => {
    expect(shouldShowPaywall({ entitlement: "unknown", experiencedValue: true }).show).toBe(false);
  });
});

describe("dark-pattern copy policy", () => {
  it("passes honest copy", () => {
    const good =
      "Premium continues your daily and weekly plans. You'll see the exact price and billing date before checkout. Cancel anytime; you keep access until the period ends.";
    expect(checkPaywallCopy(good).clean).toBe(true);
  });

  it("flags fake urgency, scarcity, guilt and confusing close controls", () => {
    expect(checkPaywallCopy("Hurry, last chance — ends tonight!").violations).toContain("fake_urgency");
    expect(checkPaywallCopy("Only 3 spots left").violations).toContain("fake_scarcity");
    expect(checkPaywallCopy("15 minutes left to subscribe").violations).toContain("countdown");
    expect(checkPaywallCopy("No, I don't care about my wellbeing").violations).toContain("confusing_close");
  });
});

describe("shipped pricing copy is clean", () => {
  it("the pricing page contains no dark patterns", () => {
    // Guards the real surface against a future manipulative edit.
    const src = readFileSync("src/app/pricing/page.tsx", "utf8");
    // Strip code tokens that could coincidentally match (imports, props); scan
    // the visible string literals only, loosely, by checking the whole file.
    const result = checkPaywallCopy(src);
    expect(result.violations, `pricing page dark patterns: ${result.violations.join(", ")}`).toEqual([]);
  });
});
