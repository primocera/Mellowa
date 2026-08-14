import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_MESSAGES,
  allowlistedDeepLink,
  DEEP_LINK_ALLOWLIST,
} from "@/lib/email/lifecycle-catalog";
import { EMAIL_CATEGORIES, isOptionalEmail } from "@/lib/email/categories";

/**
 * MW-V18-17: every lifecycle message declares purpose, a durable-fact trigger,
 * consent class, dedupe key and suppression; consent is consistent with the
 * category registry; and deep links are allowlisted internal paths.
 */

describe("lifecycle catalog completeness", () => {
  it("has exactly one entry per registered email template", () => {
    expect(Object.keys(LIFECYCLE_MESSAGES).sort()).toEqual(Object.keys(EMAIL_CATEGORIES).sort());
  });

  it("every message declares all contract fields", () => {
    for (const [name, spec] of Object.entries(LIFECYCLE_MESSAGES)) {
      expect(spec.purpose, `${name}.purpose`).toBeTruthy();
      expect(spec.trigger, `${name}.trigger`).toBeTruthy();
      expect(spec.dedupeKey, `${name}.dedupeKey`).toMatch(/:/); // key-shaped
      expect(spec.suppression, `${name}.suppression`).toBeTruthy();
    }
  });

  it("consent class matches the category registry (single source of truth)", () => {
    for (const [name, spec] of Object.entries(LIFECYCLE_MESSAGES)) {
      const expected = isOptionalEmail(name) ? "optional" : "transactional";
      expect(spec.consentClass, name).toBe(expected);
    }
  });

  it("billing/identity/deletion messages are transactional and keyed to a durable id", () => {
    for (const name of ["trial_started", "payment_failed", "account_deleted", "canceled"] as const) {
      expect(LIFECYCLE_MESSAGES[name].consentClass).toBe("transactional");
      // Keyed on a durable server id (subscription/invoice/request), not a view.
      expect(LIFECYCLE_MESSAGES[name].dedupeKey).toMatch(/<(subscriptionId|invoiceId|requestId|periodEnd)>/);
    }
  });
});

describe("deep links are allowlisted internal paths", () => {
  it("accepts allowlisted internal paths (with query)", () => {
    expect(allowlistedDeepLink("/today")).toBe("/today");
    expect(allowlistedDeepLink("/weekly-plan?ref=email")).toBe("/weekly-plan?ref=email");
  });

  it("rejects external URLs, protocol-relative and unknown paths", () => {
    expect(allowlistedDeepLink("https://evil.example.com")).toBeNull();
    expect(allowlistedDeepLink("//evil.example.com")).toBeNull();
    expect(allowlistedDeepLink("/admin/secrets")).toBeNull();
  });

  it("the allowlist is all relative internal paths", () => {
    for (const p of DEEP_LINK_ALLOWLIST) expect(p).toMatch(/^\/[a-z-]/);
  });
});
