import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Runs the REAL webhook handler (transport mocked, as in
 * webhook-order-integration.test.ts) for two 055-era behaviours:
 *
 *   - claim_stripe_event no longer re-claims a row that is still being
 *     processed. A duplicate that arrives during that window must get a
 *     retryable 409, not a 200 "duplicate" that would make Stripe stop retrying
 *     an event whose first delivery may still crash.
 *   - customer.subscription.deleted for an account that was already deleted:
 *     the subscriptions upsert hits a foreign-key violation (the profiles row is
 *     gone). That is acked (event done), not failed for 3 days of retries.
 */

const h = vi.hoisted(() => ({
  claimable: true,
  eventStatus: new Map<string, string>(),
  upsertError: null as null | { code: string; message: string },
  upserts: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: (body: string) => JSON.parse(body) },
  }),
}));

vi.mock("@/lib/env", () => ({
  serverEnv: {
    stripeWebhookSecret: "whsec_test",
    stripePriceProMonthly: "price_m",
    stripePriceProYearly: "price_y",
  },
}));

vi.mock("@/lib/email/deliver", () => ({ deliverEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/email/templates", () => ({
  paymentFailedEmail: () => ({ subject: "", html: "" }),
  paymentRecoveredEmail: () => ({ subject: "", html: "" }),
  trialStartedEmail: () => ({ subject: "", html: "" }),
  trialEndedEmail: () => ({ subject: "", html: "" }),
}));
vi.mock("@/lib/email/billing-facts", () => ({
  factsFromInvoice: () => ({}),
  factsFromSubscription: () => ({}),
}));

vi.mock("@/lib/supabase/admin", () => {
  function from(name: string) {
    const st: { op: string | null; payload: Record<string, unknown> | null; filters: Record<string, unknown> } = {
      op: null,
      payload: null,
      filters: {},
    };
    const exec = async () => {
      if (name === "stripe_events" && st.op === "update" && st.payload) {
        h.eventStatus.set(String(st.filters.event_id), String(st.payload.status));
      }
      if (name === "subscriptions" && st.op === "upsert") {
        if (st.payload) h.upserts.push(st.payload);
        return { data: null, error: h.upsertError };
      }
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {
      select() { st.op = st.op ?? "select"; return chain; },
      update(p: Record<string, unknown>) { st.op = "update"; st.payload = p; return chain; },
      upsert(p: Record<string, unknown>) { st.op = "upsert"; st.payload = p; return chain; },
      eq(col: string, val: unknown) { st.filters[col] = val; return chain; },
      maybeSingle: async () => {
        if (name === "stripe_events") {
          const status = h.eventStatus.get(String(st.filters.event_id));
          return { data: status ? { status } : null, error: null };
        }
        return { data: null, error: null };
      },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return chain;
  }
  return {
    createAdminClient: () => ({
      rpc: async (fn: string, args: { p_event_id: string }) => {
        if (fn === "claim_stripe_event") {
          if (!h.claimable) return { data: false, error: null };
          h.eventStatus.set(args.p_event_id, "processing");
          return { data: true, error: null };
        }
        return { data: null, error: null };
      },
      auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
      from,
    }),
  };
});

import { POST } from "@/app/api/stripe/webhook/route";

function post(event: unknown) {
  return POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: JSON.stringify(event),
    }),
  );
}

const deleted = (id: string) => ({
  id,
  type: "customer.subscription.deleted",
  created: 3000,
  data: {
    object: {
      id: "sub_gone",
      customer: "cus_gone",
      status: "canceled",
      metadata: { app: "mellowa", supabase_user_id: "user_gone" },
      items: { data: [{ price: { id: "price_m" }, current_period_end: 4000 }] },
      trial_start: null,
      trial_end: null,
      cancel_at_period_end: false,
      currency: "usd",
    },
  },
});

describe("webhook claim + deleted-account handling", () => {
  beforeEach(() => {
    h.claimable = true;
    h.eventStatus.clear();
    h.upsertError = null;
    h.upserts = [];
  });

  it("a duplicate while the first delivery is still processing gets a retryable 409", async () => {
    h.claimable = false;
    h.eventStatus.set("evt_live", "processing");
    const res = await post(deleted("evt_live"));
    expect(res.status).toBe(409);
    expect(h.upserts).toHaveLength(0);
  });

  it("a duplicate of a finished event is still acked as a duplicate", async () => {
    h.claimable = false;
    h.eventStatus.set("evt_done", "done");
    const res = await post(deleted("evt_done"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ duplicate: true });
  });

  it("subscription.deleted for a deleted account is acked and the event marked done", async () => {
    h.upsertError = { code: "23503", message: "violates foreign key constraint" };
    const res = await post(deleted("evt_fk"));
    expect(res.status).toBe(200);
    expect(h.upserts).toHaveLength(1);
    expect(h.eventStatus.get("evt_fk")).toBe("done");
  });

  it("any other upsert error still fails the event so Stripe retries", async () => {
    h.upsertError = { code: "57014", message: "statement timeout" };
    const res = await post(deleted("evt_timeout"));
    expect(res.status).toBe(500);
    expect(h.eventStatus.get("evt_timeout")).toBe("failed");
  });
});
