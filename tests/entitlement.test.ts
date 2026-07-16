import { describe, it, expect } from "vitest";
import { entitlementFor, PREMIUM_FEATURES } from "@/lib/stripe/plans";

describe("entitlement matrix (Prompt 3)", () => {
  it("grants generation only to trialing and active", () => {
    expect(entitlementFor("trialing").generate).toBe(true);
    expect(entitlementFor("active").generate).toBe(true);
    for (const s of ["none", "incomplete", "past_due", "unpaid", "canceled"]) {
      expect(entitlementFor(s).generate).toBe(false);
    }
  });

  it("never locks users out of reading their own data", () => {
    for (const s of [
      "none",
      "incomplete",
      "trialing",
      "active",
      "past_due",
      "unpaid",
      "canceled",
      "something_unknown",
      null,
      undefined,
    ]) {
      expect(entitlementFor(s as string).read).toBe(true);
    }
  });

  it("allows checkout only when no live subscription exists", () => {
    expect(entitlementFor("none").checkout).toBe(true);
    expect(entitlementFor("canceled").checkout).toBe(true);
    expect(entitlementFor("incomplete").checkout).toBe(true); // abandoned checkout retry
    for (const s of ["trialing", "active", "past_due", "unpaid"]) {
      expect(entitlementFor(s).checkout).toBe(false);
    }
  });

  it("fails closed on unknown statuses", () => {
    const e = entitlementFor("paused");
    expect(e.generate).toBe(false);
    expect(e.checkout).toBe(false);
  });

  it("pricing copy never promises absolute unlimited plans", () => {
    for (const f of PREMIUM_FEATURES) {
      expect(f.toLowerCase()).not.toContain("unlimited");
    }
  });
});
