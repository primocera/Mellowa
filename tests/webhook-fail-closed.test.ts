import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit B1 + B2: a failed database read or write inside the Stripe webhook must
 * never be treated as "no row" / "nothing to do".
 *
 * These run the REAL `POST` handler from `src/app/api/stripe/webhook/route.ts`
 * against an in-memory `subscriptions` table whose reads and writes can be made
 * to fail on demand — the same harness shape as
 * `tests/webhook-order-integration.test.ts`, plus error injection and upsert.
 *
 *   B1 — `syncSubscription` discarded the read error on the existing row, so a
 *        transient failure upserted `trial_used_at: null` and re-opened the
 *        one-trial-per-person lock. The customer lookup had the same hole: a
 *        failed read made a Mellowa subscription look like another product's.
 *   B2 — both invoice branches finalized the event `done` when the row read
 *        failed, and never checked the status update, so a dunning recovery
 *        (past_due → active) could be dropped for a customer who had paid.
 *
 * In every failure case the handler must answer non-2xx (Stripe redelivers),
 * mark the event `failed`, and leave the row exactly as it was.
 */

type Row = Record<string, unknown>;
type Filters = Record<string, unknown>;

const h = vi.hoisted(() => ({
  subs: [] as Record<string, unknown>[],
  claimed: new Set<string>(),
  eventStatus: new Map<string, string>(),
  upserts: [] as Record<string, unknown>[],
  /** Return true to make a `subscriptions` read fail. */
  failRead: null as null | ((columns: string, filters: Record<string, unknown>) => boolean),
  /** Return true to make a `subscriptions` update/upsert fail. */
  failWrite: null as null | ((op: string) => boolean),
  deliverEmail: vi.fn(async () => {}),
  trackEvent: vi.fn(),
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
  const DB_ERROR = { message: "connection reset (simulated)" };
  const match = (row: Row, filters: Filters) =>
    Object.entries(filters).every(([k, v]) => row[k] === v);

  function from(name: string) {
    const st: { op: string | null; columns: string; payload: Row | null; filters: Filters } = {
      op: null,
      columns: "",
      payload: null,
      filters: {},
    };
    const exec = async () => {
      if (name === "stripe_events" && st.op === "update" && st.payload) {
        h.eventStatus.set(String(st.filters.event_id), String(st.payload.status));
        return { data: null, error: null };
      }
      if (name !== "subscriptions") return { data: null, error: null };
      if (st.op === "update" || st.op === "upsert") {
        if (h.failWrite?.(st.op)) return { data: null, error: DB_ERROR };
        if (st.op === "upsert" && st.payload) {
          h.upserts.push({ ...st.payload });
          const existing = h.subs.find((r) => r.user_id === st.payload!.user_id);
          if (existing) Object.assign(existing, st.payload);
          else h.subs.push({ ...st.payload });
        } else if (st.payload) {
          for (const r of h.subs) if (match(r, st.filters)) Object.assign(r, st.payload);
        }
      }
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {
      select(columns: string) { st.op = "select"; st.columns = columns; return chain; },
      update(p: Row) { st.op = "update"; st.payload = p; return chain; },
      upsert(p: Row) { st.op = "upsert"; st.payload = p; return chain; },
      eq(col: string, val: unknown) { st.filters[col] = val; return chain; },
      maybeSingle: async () => {
        if (name !== "subscriptions") return { data: null, error: null };
        if (h.failRead?.(st.columns, st.filters)) return { data: null, error: DB_ERROR };
        return { data: h.subs.find((r) => match(r, st.filters)) ?? null, error: null };
      },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return chain;
  }

  return {
    createAdminClient: () => ({
      rpc: async (fn: string, args: { p_event_id: string }) => {
        if (fn === "claim_stripe_event") {
          // Mirrors migration 006: only a `done` event is refused; a failed one
          // is re-claimable so Stripe's redelivery actually runs.
          if (h.eventStatus.get(args.p_event_id) === "done") return { data: false, error: null };
          h.claimed.add(args.p_event_id);
          return { data: true, error: null };
        }
        return { data: null, error: null };
      },
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "owner@example.com" } },
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

const TRIAL_USED_AT = "2026-01-10T00:00:00.000Z";

/** A paid (no-trial) resubscription for a user who used their trial long ago. */
function subscriptionEvent(
  id: string,
  created: number,
  opts: { tagged?: boolean; type?: string } = {},
) {
  return {
    id,
    type: opts.type ?? "customer.subscription.created",
    created,
    data: {
      object: {
        id: "sub_new",
        customer: "cus_x",
        status: "active",
        currency: "usd",
        cancel_at_period_end: false,
        trial_start: null,
        trial_end: null,
        metadata:
          opts.tagged === false ? {} : { app: "mellowa", supabase_user_id: "user_x" },
        items: { data: [{ current_period_end: 1_900_000_000, price: { id: "price_m" } }] },
      },
    },
  };
}

const invoiceEvent = (type: string, id: string, created: number) => ({
  id,
  type,
  created,
  data: { object: { id: "in_1", customer: "cus_x", billing_reason: "subscription_cycle" } },
});

const row = () => h.subs.find((r) => r.user_id === "user_x")!;

beforeEach(() => {
  h.subs.length = 0;
  h.upserts.length = 0;
  h.claimed.clear();
  h.eventStatus.clear();
  h.failRead = null;
  h.failWrite = null;
  h.deliverEmail.mockClear();
  h.trackEvent.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  h.subs.push({
    user_id: "user_x",
    stripe_customer_id: "cus_x",
    stripe_subscription_id: "sub_old",
    status: "canceled",
    trial_used_at: TRIAL_USED_AT,
    first_trial_subscription_id: "sub_old",
    trial_variant: null,
    trial_days: 7,
    current_period_end: null,
    last_stripe_event_created: 500,
  });
});

describe("B1 — syncSubscription never writes over an unverified row", () => {
  it("control: a healthy read keeps the trial lock through a paid resubscription", async () => {
    const res = await post(subscriptionEvent("evt_ok", 1000));
    expect(res.status).toBe(200);
    expect(row().status).toBe("active");
    expect(row().trial_used_at).toBe(TRIAL_USED_AT);
    expect(row().first_trial_subscription_id).toBe("sub_old");
    expect(row().trial_days).toBe(7);
  });

  it("a failed read of the existing row is retried and does NOT erase trial_used_at", async () => {
    h.failRead = (columns) => columns.includes("trial_used_at");

    const res = await post(subscriptionEvent("evt_b1", 1000));

    expect(res.status, "a failed read must not be acked — Stripe has to redeliver").toBe(500);
    expect(h.upserts, "nothing may be written from an unverified read").toHaveLength(0);
    expect(row().trial_used_at, "the one-trial-ever lock was erased").toBe(TRIAL_USED_AT);
    expect(row().first_trial_subscription_id).toBe("sub_old");
    expect(row().status).toBe("canceled");
    expect(h.eventStatus.get("evt_b1")).toBe("failed");
  });

  it("the redelivery after a transient read failure applies cleanly with the lock intact", async () => {
    h.failRead = (columns) => columns.includes("trial_used_at");
    expect((await post(subscriptionEvent("evt_b1", 1000))).status).toBe(500);

    h.failRead = null;
    const res = await post(subscriptionEvent("evt_b1", 1000));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.not.toMatchObject({ duplicate: true });
    expect(row().status).toBe("active");
    expect(row().trial_used_at).toBe(TRIAL_USED_AT);
  });

  it("a failed customer lookup is retried, not mistaken for another product's subscription", async () => {
    // No Mellowa metadata on the object, so ownership rests on the stored
    // customer row. If that read fails we cannot conclude "not ours".
    h.failRead = (columns, filters) => columns === "user_id" && "stripe_customer_id" in filters;

    const res = await post(
      subscriptionEvent("evt_lookup", 1000, {
        tagged: false,
        type: "customer.subscription.updated",
      }),
    );

    expect(res.status).toBe(500);
    expect(h.upserts).toHaveLength(0);
    expect(row().status).toBe("canceled");
    expect(h.eventStatus.get("evt_lookup")).toBe("failed");
  });

  it("control: an untagged subscription with a verified 'no such customer' is still acked", async () => {
    h.subs.length = 0; // genuinely not our customer
    const res = await post(
      subscriptionEvent("evt_foreign", 1000, {
        tagged: false,
        type: "customer.subscription.updated",
      }),
    );
    expect(res.status).toBe(200);
    expect(h.upserts).toHaveLength(0);
    expect(h.eventStatus.get("evt_foreign")).toBe("done");
  });
});

describe("B2 — invoice branches treat DB errors as retryable", () => {
  it("payment_failed: a failed row read is retried, not finalized done", async () => {
    row().status = "active";
    h.failRead = () => true;

    const res = await post(invoiceEvent("invoice.payment_failed", "evt_pf_read", 1000));

    expect(res.status).toBe(500);
    expect(row().status).toBe("active");
    expect(h.deliverEmail).not.toHaveBeenCalled();
    expect(h.eventStatus.get("evt_pf_read")).toBe("failed");
  });

  it("payment_failed: a failed status write is retried and sends no email", async () => {
    row().status = "active";
    h.failWrite = (op) => op === "update";

    const res = await post(invoiceEvent("invoice.payment_failed", "evt_pf_write", 1000));

    expect(res.status).toBe(500);
    expect(row().status).toBe("active");
    expect(h.deliverEmail, "told the user payment failed without recording it").not.toHaveBeenCalled();
    expect(h.trackEvent).not.toHaveBeenCalled();
    expect(h.eventStatus.get("evt_pf_write")).toBe("failed");
  });

  it("payment_succeeded: a failed row read is retried, so a recovery is not dropped", async () => {
    row().status = "past_due";
    h.failRead = () => true;

    const res = await post(invoiceEvent("invoice.payment_succeeded", "evt_ps_read", 1000));

    expect(res.status, "a paid customer's recovery was acked without being applied").toBe(500);
    expect(h.eventStatus.get("evt_ps_read")).toBe("failed");

    // Stripe redelivers; the read works this time and access is restored.
    h.failRead = null;
    const retry = await post(invoiceEvent("invoice.payment_succeeded", "evt_ps_read", 1000));
    expect(retry.status).toBe(200);
    expect(row().status).toBe("active");
  });

  it("payment_succeeded: a failed recovery write is retried and sends no 'recovered' email", async () => {
    row().status = "past_due";
    h.failWrite = (op) => op === "update";

    const res = await post(invoiceEvent("invoice.payment_succeeded", "evt_ps_write", 1000));

    expect(res.status).toBe(500);
    expect(row().status).toBe("past_due");
    expect(h.deliverEmail, "told the user access is back while the row is still past_due").not.toHaveBeenCalled();
    expect(h.trackEvent).not.toHaveBeenCalled();
    expect(h.eventStatus.get("evt_ps_write")).toBe("failed");
  });

  it("control: failure then recovery still works end to end", async () => {
    row().status = "active";
    expect((await post(invoiceEvent("invoice.payment_failed", "evt_f", 1000))).status).toBe(200);
    expect(row().status).toBe("past_due");
    expect((await post(invoiceEvent("invoice.payment_succeeded", "evt_s", 2000))).status).toBe(200);
    expect(row().status).toBe("active");
    expect(h.deliverEmail).toHaveBeenCalledTimes(2);
  });
});
