import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Steps 5–6 of the live-transaction rehearsal, exercised against the REAL
 * webhook handler at runtime (not a model of it, and not a source scan).
 *
 * `tests/billing-lifecycle-order.test.ts` already proves the pure ordering guard
 * and mirrors the route's rule in a hand-written model; this file complements it
 * by actually invoking `POST` from `src/app/api/stripe/webhook/route.ts` with the
 * transport mocked out — an in-memory `subscriptions` table, recorded (never
 * sent) emails, a stubbed Stripe verifier. It executes the handler's own
 * read → guard → update → email decision, so a regression in the *wiring*
 * (not just the guard) is caught. No Stripe, no Supabase, no network.
 *
 * The distinction the two layers enforce, made explicit here:
 *   - A redelivery of the SAME event id is stopped by idempotency
 *     (`claim_stripe_event`) before any handling.
 *   - A DISTINCT, older `payment_failed` arriving AFTER a newer recovery is
 *     stopped by the created-order guard (`shouldApplyStripeEvent`). This is the
 *     money bug: a late failure must not drag a paying customer back to past_due.
 */

const h = vi.hoisted(() => ({
  subs: new Map<string, Record<string, unknown>>(),
  claimed: new Set<string>(),
  emails: new Map<string, string>(),
  deliverEmail: vi.fn(async () => {}),
  trackEvent: vi.fn(),
}));

vi.mock("@/lib/stripe/client", () => ({
  // The event is carried verbatim in the request body; skip real signature work.
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

vi.mock("@/lib/email/deliver", () => ({ deliverEmail: h.deliverEmail }));
vi.mock("@/lib/analytics", () => ({ trackEvent: h.trackEvent }));

vi.mock("@/lib/email/templates", () => ({
  paymentFailedEmail: () => ({ subject: "failed", html: "failed" }),
  paymentRecoveredEmail: () => ({ subject: "recovered", html: "recovered" }),
  trialStartedEmail: () => ({ subject: "", html: "" }),
  trialEndedEmail: () => ({ subject: "", html: "" }),
}));

vi.mock("@/lib/email/billing-facts", () => ({
  factsFromInvoice: () => ({}),
  factsFromSubscription: () => ({}),
}));

vi.mock("@/lib/supabase/admin", () => {
  const { subs, claimed, emails } = h;
  // A tiny PostgREST-shaped builder: enough of `.from().select().eq().maybeSingle()`
  // and `.from().update().eq()` for the two invoice branches to run unchanged.
  function from(name: string) {
    const st: { op: string | null; payload: Record<string, unknown> | null; filters: Record<string, unknown> } = {
      op: null,
      payload: null,
      filters: {},
    };
    const exec = async () => {
      if (name === "subscriptions" && st.op === "update") {
        const row = subs.get(String(st.filters.stripe_customer_id));
        if (row && st.payload) Object.assign(row, st.payload);
      }
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {
      select() { st.op = "select"; return chain; },
      update(p: Record<string, unknown>) { st.op = "update"; st.payload = p; return chain; },
      insert(p: Record<string, unknown>) { st.op = "insert"; st.payload = p; return chain; },
      eq(col: string, val: unknown) { st.filters[col] = val; return chain; },
      maybeSingle: async () => {
        if (name === "subscriptions") {
          return { data: subs.get(String(st.filters.stripe_customer_id)) ?? null, error: null };
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
          if (claimed.has(args.p_event_id)) return { data: false, error: null };
          claimed.add(args.p_event_id);
          return { data: true, error: null };
        }
        return { data: null, error: null };
      },
      auth: {
        admin: {
          getUserById: async (uid: string) => ({
            data: { user: emails.has(uid) ? { email: emails.get(uid) } : null },
            error: null,
          }),
        },
      },
      from,
    }),
  };
});

// Import AFTER the mocks are registered.
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

const failed = (id: string, created: number) => ({
  id,
  type: "invoice.payment_failed",
  created,
  data: { object: { id: "in_f", customer: "cus_x" } },
});
const succeeded = (id: string, created: number) => ({
  id,
  type: "invoice.payment_succeeded",
  created,
  data: { object: { id: "in_s", customer: "cus_x", billing_reason: "subscription_cycle" } },
});
const row = () => h.subs.get("cus_x")!;

describe("real webhook handler — billing lifecycle steps 5–6", () => {
  beforeEach(() => {
    h.subs.clear();
    h.claimed.clear();
    h.emails.clear();
    h.deliverEmail.mockClear();
    h.trackEvent.mockClear();
    h.subs.set("cus_x", {
      stripe_customer_id: "cus_x",
      user_id: "user_x",
      status: "active",
      last_stripe_event_created: 500,
    });
    h.emails.set("user_x", "owner@example.com");
  });

  it("failure → recovery → LATE distinct failure keeps the paid user active", async () => {
    // Step 5a — failure at t=1000 → past_due, failure email sent.
    let res = await post(failed("evt_f1", 1000));
    expect(res.status).toBe(200);
    expect(row().status).toBe("past_due");
    expect(row().last_stripe_event_created).toBe(1000);
    expect(h.deliverEmail).toHaveBeenCalledTimes(1);

    // Step 5b — recovery at t=2000 → active, recovery email sent. Watermark advances.
    res = await post(succeeded("evt_s1", 2000));
    expect(res.status).toBe(200);
    expect(row().status).toBe("active");
    expect(row().last_stripe_event_created).toBe(2000);
    expect(h.deliverEmail).toHaveBeenCalledTimes(2);

    // Step 6 — a DISTINCT older failure (created 1500 < watermark 2000) arrives
    // last. The created-order guard must drop it: no revert, no watermark move,
    // no third email. This is the money bug, proven through the real handler.
    res = await post(failed("evt_f2", 1500));
    expect(res.status).toBe(200);
    expect(row().status, "a stale failure dragged a paid user back to past_due").toBe("active");
    expect(row().last_stripe_event_created).toBe(2000);
    expect(h.deliverEmail).toHaveBeenCalledTimes(2);
  });

  it("a same-id redelivery is dropped by idempotency before any handling", async () => {
    await post(failed("evt_f1", 1000));
    expect(row().status).toBe("past_due");
    h.deliverEmail.mockClear();

    const res = await post(failed("evt_f1", 1000)); // identical event id
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ duplicate: true });
    expect(h.deliverEmail).not.toHaveBeenCalled();
  });
});
