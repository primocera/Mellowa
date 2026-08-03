import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-04: route-level behavioral tests for the Stripe checkout route.
 *
 * Source-string presence is not enough — these prove ORDERING: that no Stripe
 * mutation happens before billing state is verified, that a failed subscription
 * read or a failed customer-link fails closed with a 503, and that an existing
 * payer is never offered a second trial. The billing-state classifier is REAL;
 * only the Supabase, Stripe, env and price-resolver boundaries are mocked.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: {
    id: "u1",
    email: "u1@example.com",
    email_confirmed_at: "2026-01-01T00:00:00Z",
  } as { id: string; email: string; email_confirmed_at: string | null } | null,
  // subscriptions read result (data + error, classified by the REAL classifier)
  subRead: { data: null as Row | null, error: null as Row | null },
  // customer-link upsert result
  upsertError: null as Row | null,
  // trial-variant pin update result
  pinResult: { data: [{ user_id: "u1" }] as Row[] | null, error: null as Row | null },
  // Stripe knobs
  customerCreateError: null as unknown,
  sessionCreateError: null as unknown,
  // spies
  stripeCalls: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => h.subRead }) }),
      upsert: async () => ({ error: h.upsertError }),
      update: () => ({ eq: () => ({ select: async () => h.pinResult }) }),
    }),
  }),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    customers: {
      create: async () => {
        h.stripeCalls.push("customers.create");
        if (h.customerCreateError) throw h.customerCreateError;
        return { id: "cus_new" };
      },
    },
    checkout: {
      sessions: {
        create: async () => {
          h.stripeCalls.push("checkout.sessions.create");
          if (h.sessionCreateError) throw h.sessionCreateError;
          return { url: "https://stripe.test/session" };
        },
      },
    },
  }),
}));

vi.mock("@/lib/env", () => ({ serverEnv: { appUrl: "https://app.test" } }));

vi.mock("@/lib/stripe/price-resolver", () => ({
  resolvePrice: () => ({ priceId: "price_test", currency: "usd" }),
}));

import { POST } from "@/app/api/stripe/checkout/route";

function req(interval: "monthly" | "yearly" = "monthly") {
  return new Request("https://app.test/api/stripe/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ interval }),
  });
}

beforeEach(() => {
  h.user = { id: "u1", email: "u1@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
  h.subRead = { data: null, error: null };
  h.upsertError = null;
  h.pinResult = { data: [{ user_id: "u1" }], error: null };
  h.customerCreateError = null;
  h.sessionCreateError = null;
  h.stripeCalls = [];
});

describe("checkout fails closed when billing state cannot be verified", () => {
  it("returns 503 retryable and makes NO Stripe call when the subscription read errors", async () => {
    h.subRead = { data: null, error: { code: "PGRST500" } };
    const res = await POST(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("billing_unavailable");
    expect(body.retryable).toBe(true);
    // No raw Supabase message leaked.
    expect(JSON.stringify(body)).not.toContain("PGRST500");
    expect(h.stripeCalls).toEqual([]); // no customer, no session
  });

  it("returns 503 after creating a customer but failing to LINK it (orphan-risk)", async () => {
    h.subRead = { data: null, error: null }; // verified_none → new customer
    h.upsertError = { code: "23505" };
    const res = await POST(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("customer_link_failed");
    // The customer was created, but checkout was NOT opened on an unlinked one.
    expect(h.stripeCalls).toContain("customers.create");
    expect(h.stripeCalls).not.toContain("checkout.sessions.create");
  });

  it("returns 503 when the trial-variant pin matches zero rows (no session)", async () => {
    h.subRead = { data: null, error: null };
    h.pinResult = { data: [], error: null }; // zero-row update = failed pin
    const res = await POST(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("trial_pin_failed");
    expect(h.stripeCalls).not.toContain("checkout.sessions.create");
  });
});

describe("checkout honors verified billing state", () => {
  it("blocks an already-subscribed (active) user with 400 and no Stripe call", async () => {
    h.subRead = { data: { status: "active", stripe_customer_id: "cus_1" }, error: null };
    const res = await POST(req());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("already_subscribed");
    expect(h.stripeCalls).toEqual([]);
  });

  it("never offers a second trial to a canceled user who already used one", async () => {
    h.subRead = {
      data: { status: "canceled", trial_used_at: "2026-05-01T00:00:00Z", stripe_customer_id: "cus_1" },
      error: null,
    };
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trial).toBe(false); // paid from day one, no trial
    expect(body.trialDays).toBe(0);
    // Existing customer reused; no new customer created.
    expect(h.stripeCalls).toEqual(["checkout.sessions.create"]);
  });

  it("opens a trial checkout for a genuinely new (verified_none) customer", async () => {
    h.subRead = { data: null, error: null };
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trial).toBe(true);
    expect(typeof body.url).toBe("string");
    expect(h.stripeCalls).toEqual(["customers.create", "checkout.sessions.create"]);
  });

  it("returns 502 with safe copy when Stripe fails AFTER billing is verified", async () => {
    h.subRead = {
      data: { status: "canceled", trial_used_at: "2026-05-01T00:00:00Z", stripe_customer_id: "cus_1" },
      error: null,
    };
    h.sessionCreateError = new Error("stripe upstream 500");
    const res = await POST(req());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("stripe upstream 500");
  });
});
