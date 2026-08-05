import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { findMellowaCustomer } from "@/lib/stripe/customer";

/**
 * XAPP-01 (Mellowa side): a Scalvya/Frost customer, subscription, product or
 * price on the SHARED Stripe account can never be adopted, charged, emailed or
 * counted as Mellowa's — and vice versa. Ownership is metadata
 * (supabase_user_id + app), never a shared email. The Scalvya side of this
 * matrix is audited in its own repository.
 */

vi.mock("@/lib/env", () => ({
  serverEnv: {
    stripePriceProMonthly: "price_mellowa_monthly",
    stripePriceProYearly: "price_mellowa_yearly",
  },
}));

describe("ownership is proven by metadata, not by a shared email", () => {
  it("the recovery search filters on supabase_user_id AND app, never email", async () => {
    let capturedQuery = "";
    const stripe = {
      customers: {
        search: async (opts: { query: string }) => {
          capturedQuery = opts.query;
          return { data: [] };
        },
      },
    } as unknown as Parameters<typeof findMellowaCustomer>[0];

    await findMellowaCustomer(stripe, "user-123");
    expect(capturedQuery).toContain("metadata['supabase_user_id']:'user-123'");
    expect(capturedQuery).toContain("metadata['app']:'mellowa'");
    // A shared email must never be the ownership key.
    expect(capturedQuery).not.toContain("@");
    expect(capturedQuery.toLowerCase()).not.toContain("email");
  });

  it("two owned candidates fail closed rather than guess which to charge", async () => {
    const stripe = {
      customers: {
        search: async () => ({ data: [{ id: "cus_A" }, { id: "cus_B" }] }),
      },
    } as unknown as Parameters<typeof findMellowaCustomer>[0];
    expect(await findMellowaCustomer(stripe, "u1")).toEqual({
      kind: "multiple",
      customerIds: ["cus_A", "cus_B"],
    });
  });
});

describe("reconciliation never adopts a foreign product's subscription", () => {
  it("throws on a foreign price rather than storing a plan it cannot map", async () => {
    const { adoptSubscriptionForCustomer } = await import("@/lib/stripe/reconcile");
    const stripe = {
      subscriptions: {
        list: async () => ({
          data: [
            {
              id: "sub_foreign",
              status: "active",
              trial_start: null,
              items: { data: [{ price: { id: "price_scalvya_studio" } }] },
            },
          ],
        }),
      },
    } as unknown as Parameters<typeof adoptSubscriptionForCustomer>[0];
    const admin = {} as Parameters<typeof adoptSubscriptionForCustomer>[1];

    await expect(
      adoptSubscriptionForCustomer(stripe, admin, "u1", "cus_shared")
    ).rejects.toThrow(/unknown Stripe price/i);
  });
});

describe("the checkout route stamps the app namespace everywhere it mints objects", () => {
  const route = readFileSync("src/app/api/stripe/checkout/route.ts", "utf8");

  it("tags customer, session and subscription metadata with app: MELLOWA_APP", () => {
    // customer.create metadata + session metadata + subscription_data metadata.
    const appTags = route.match(/app: MELLOWA_APP/g) ?? [];
    expect(appTags.length).toBeGreaterThanOrEqual(3);
  });

  it("namespaces both idempotency keys and keys them on user id, not email", () => {
    // customer key via helper, session key inline — both carry the mellowa_ ns.
    expect(route).toContain("customerIdempotencyKey(user.id)");
    expect(route).toContain("idempotencyKey: `mellowa_checkout_${user.id}");
    // No idempotency key is built from the email.
    expect(route).not.toMatch(/idempotencyKey:[^\n]*user\.email/);
  });
});
