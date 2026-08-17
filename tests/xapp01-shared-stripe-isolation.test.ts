import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { verifyMellowaCustomerOwnership, MELLOWA_APP } from "@/lib/stripe/customer";

/**
 * XAPP-01 (v20): shared-Stripe object-graph isolation, Mellowa side.
 *
 * The isolation predicate (metadata.app === "mellowa" AND matching
 * supabase_user_id; email/price are never ownership proof) is unchanged in v20
 * (Stripe code is frozen at v16) and covered broadly by the v17/v19 matrices
 * (cross-app-isolation, webhook-isolation, xapp-object-graph, xapp-ownership-
 * matrix, xapp02-release-sweep). This file re-runs the negative fixture matrix
 * at the v20 SHA against the exact ownership function and pins the sweep so any
 * future weakening of the predicate fails here.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

function stripeReturning(
  customer: Partial<Stripe.Customer> | { deleted: true } | { throw: { code?: string } }
): Stripe {
  return {
    customers: {
      retrieve: async () => {
        if ("throw" in customer) throw customer.throw;
        return customer as Stripe.Customer | Stripe.DeletedCustomer;
      },
    },
  } as unknown as Stripe;
}

const cust = (metadata: Record<string, string>): Partial<Stripe.Customer> => ({
  id: "cus_x",
  metadata: metadata as Stripe.Metadata,
});

describe("XAPP-01: only exact Mellowa metadata is owned; everything else is foreign", () => {
  // The shared negative matrix: exact-mellowa, exact-scalvya, frost/unknown,
  // unstamped, bare user id (no app), same email, same price, conflicting
  // stamps, deleted, ambiguous legacy.
  const foreignFixtures: Array<[string, Partial<Stripe.Customer> | { deleted: true }]> = [
    ["exact scalvya", cust({ app: "scalvya", supabase_user_id: USER })],
    ["frost / unknown app", cust({ app: "frost", supabase_user_id: USER })],
    ["unstamped (no metadata)", cust({})],
    ["bare user id, no app namespace", cust({ supabase_user_id: USER })],
    ["same email, no app", cust({ email_hint: "shared", supabase_user_id: USER })],
    ["same price, no app", cust({ price: "price_pro", supabase_user_id: USER })],
    ["conflicting stamp: mellowa app but WRONG user", cust({ app: MELLOWA_APP, supabase_user_id: OTHER_USER })],
    ["ambiguous legacy: user id but app blank", cust({ app: "", supabase_user_id: USER })],
    ["deleted customer", { deleted: true }],
  ];

  for (const [label, fixture] of foreignFixtures) {
    it(`does not adopt: ${label}`, async () => {
      const res = await verifyMellowaCustomerOwnership(stripeReturning(fixture), "cus_x", USER);
      // Never "owned" — foreign/ambiguous/deleted resolve to mismatch or missing.
      expect(res.kind).not.toBe("owned");
    });
  }

  it("adopts ONLY an exact Mellowa customer for the matching user", async () => {
    const res = await verifyMellowaCustomerOwnership(
      stripeReturning(cust({ app: MELLOWA_APP, supabase_user_id: USER })),
      "cus_x",
      USER
    );
    expect(res.kind).toBe("owned");
  });

  it("the same person legitimately using both apps stays isolated per app+user", async () => {
    // A Scalvya customer for the same human is foreign to Mellowa even with the
    // same supabase_user_id-shaped value.
    const res = await verifyMellowaCustomerOwnership(
      stripeReturning(cust({ app: "scalvya", supabase_user_id: USER })),
      "cus_x",
      USER
    );
    expect(res.kind).toBe("mismatch");
  });

  it("a transient read is UNAVAILABLE (retryable), never silently owned", async () => {
    const res = await verifyMellowaCustomerOwnership(
      stripeReturning({ throw: { code: "rate_limited" } }),
      "cus_x",
      USER
    );
    expect(res.kind).toBe("unavailable");
  });
});

describe("XAPP-01: the isolation predicate is intact at v20 (not weakened)", () => {
  it("webhook maps a user from metadata ONLY under the exact app namespace", () => {
    const src = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
    expect(src).toMatch(/metadata\.app !== MELLOWA_APP/);
    expect(src).toMatch(/supabase_user_id/);
  });
  it("ownership requires app AND user id, never email or price", () => {
    const src = readFileSync("src/lib/stripe/customer.ts", "utf8");
    expect(src).toMatch(/metadata\.app === MELLOWA_APP/);
    expect(src).toMatch(/metadata\.supabase_user_id === userId/);
  });
});
