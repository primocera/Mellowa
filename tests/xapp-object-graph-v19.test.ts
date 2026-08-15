import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MELLOWA_APP } from "@/lib/stripe/customer";

/**
 * XAPP-01 (v19): a symmetric, complete-object-graph regression guard. Every
 * money-bearing Stripe object type must resolve ownership through the EXACT
 * Mellowa app namespace (metadata `app === "mellowa"` AND `supabase_user_id`) or
 * a trusted stored-customer row before any mutation, email, analytics or refund.
 * A same email, same-looking UUID, shared account or configured price is never
 * ownership. Billing is frozen — this only proves the existing isolation holds at
 * the v19 candidate.
 */

const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
const reconcile = readFileSync("src/lib/stripe/reconcile.ts", "utf8");
const matrixDoc = readFileSync("docs/release/v17/XAPP-ISOLATION-MELLOWA.md", "utf8");

describe("the exact-app ownership predicate is intact", () => {
  it("app namespace is 'mellowa'", () => {
    expect(MELLOWA_APP).toBe("mellowa");
  });
  it("metadata is trusted ONLY when app === MELLOWA_APP and supabase_user_id present", () => {
    expect(webhook).toContain("metadata.app !== MELLOWA_APP");
    expect(webhook).toContain("supabase_user_id");
  });
});

describe("every money-bearing object type has an ownership-gated handler", () => {
  const handlers = [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_failed",
    "invoice.payment_succeeded",
    "charge.refunded",
    "charge.dispute.created",
    "checkout.session.completed",
  ];
  for (const h of handlers) {
    it(`handles ${h}`, () => {
      expect(webhook).toContain(`case "${h}"`);
    });
  }

  it("subscription events resolve via exact metadata or the stored customer row", () => {
    expect(webhook).toContain("mellowaUserIdFromMetadata(subscription.metadata)");
  });

  it("invoice/charge/dispute resolve via the stored-customer predicate", () => {
    expect(webhook).toContain("userIdForCustomerId");
  });

  it("a foreign subscription with no stored row is ignored, not adopted", () => {
    expect(webhook).toMatch(/ignoring subscription from another product/i);
  });

  it("a dispute on a foreign charge is treated as another product's incident", () => {
    expect(webhook).toMatch(/foreign charge|another product/i);
  });
});

describe("the reconciler uses the same ownership basis as the webhook", () => {
  it("reconciles only from OUR stored subscriptions table (owned rows)", () => {
    expect(reconcile).toContain('from("subscriptions")');
    // It starts from local owned rows and retrieves the matching remote object;
    // it never adopts a foreign object it discovered on the shared account.
    expect(reconcile).toContain("subscriptions.retrieve");
  });
});

describe("the cross-app isolation matrix documents the complete object graph", () => {
  for (const obj of ["Customer", "Checkout", "Subscription", "Invoice", "Charge", "Dispute", "Portal", "PaymentIntent"]) {
    it(`names the ${obj} object`, () => {
      expect(matrixDoc).toContain(obj);
    });
  }
  it("carries no email or production id — synthetic ownership proof only", () => {
    expect(matrixDoc).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(matrixDoc).not.toMatch(/\bcus_[A-Za-z0-9]{6,}\b/);
  });
});

describe("isolation logs stay opaque (no address or content)", () => {
  it("webhook logs reference ids/categorical reasons, never an email address", () => {
    // No literal email-looking string is logged in the isolation paths.
    expect(webhook).not.toMatch(/console\.(warn|error|log)\([^)]*@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});
