import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit B8: the cancel route discarded the error on its subscription read, so a
 * transient database failure told a PAYING user they had no subscription — on
 * the one path where "we could not cancel you" matters most. A failed read must
 * answer a retryable 503 (as the portal route does) and must not touch Stripe.
 *
 * Runs the real `POST` from `src/app/api/stripe/cancel/route.ts` with the
 * transport mocked.
 */

const h = vi.hoisted(() => ({
  sub: null as Record<string, unknown> | null,
  readError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  stripeUpdate: vi.fn(async (_id: string, params: { cancel_at_period_end: boolean }) => ({
    cancel_at_period_end: params.cancel_at_period_end,
  })),
  deliverEmail: vi.fn(async () => {}),
  trackEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user_x", email: "owner@example.com" } } }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from() {
      let op = "select";
      const chain: Record<string, unknown> = {
        select() { op = "select"; return chain; },
        update() { op = "update"; return chain; },
        eq() { return chain; },
        maybeSingle: async () =>
          h.readError ? { data: null, error: h.readError } : { data: h.sub, error: null },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: op === "update" ? h.updateError : null }).then(res, rej),
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({ subscriptions: { update: h.stripeUpdate } }),
}));
vi.mock("@/lib/email/deliver", () => ({ deliverEmail: h.deliverEmail }));
vi.mock("@/lib/email/templates", () => ({ canceledEmail: () => ({ subject: "", html: "" }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: h.trackEvent }));

import { POST } from "@/app/api/stripe/cancel/route";

const post = (action: "cancel" | "reactivate") =>
  POST(
    new Request("http://localhost/api/stripe/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }),
  );

beforeEach(() => {
  h.readError = null;
  h.updateError = null;
  h.sub = {
    stripe_subscription_id: "sub_1",
    status: "active",
    current_period_end: "2026-12-01T00:00:00.000Z",
    trial_end: null,
  };
  h.stripeUpdate.mockClear();
  h.deliverEmail.mockClear();
  h.trackEvent.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("B8 — cancel route fails closed on an unverified subscription read", () => {
  it("a failed read is a retryable 503, never 'no_subscription'", async () => {
    h.readError = { message: "connection reset (simulated)" };

    const res = await post("cancel");
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe("billing_unavailable");
    expect(body.retryable).toBe(true);
    expect(body.error).not.toBe("no_subscription");
    // The billing UI prints `error` verbatim — it has to be a sentence.
    expect(body.error).toMatch(/try again/i);
    expect(body.error).not.toMatch(/connection reset/);
    expect(h.stripeUpdate).not.toHaveBeenCalled();
    expect(h.deliverEmail).not.toHaveBeenCalled();
  });

  it("a verified 'no subscription' still answers no_subscription (400)", async () => {
    h.sub = null;
    const res = await post("cancel");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "no_subscription" });
    expect(h.stripeUpdate).not.toHaveBeenCalled();
  });

  it("control: a healthy cancel still sets cancel_at_period_end and confirms by email", async () => {
    const res = await post("cancel");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, cancel_at_period_end: true });
    expect(h.stripeUpdate).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(h.deliverEmail).toHaveBeenCalledTimes(1);
  });

  it("a failed local mirror write does not un-cancel: Stripe is the truth and it succeeded", async () => {
    h.updateError = { message: "connection reset (simulated)" };
    const res = await post("cancel");
    // The cancellation DID happen at Stripe. Reporting failure would invite a
    // confused retry; the webhook re-syncs the row. It is logged, not hidden.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, cancel_at_period_end: true });
    expect(console.error).toHaveBeenCalledWith(
      "[stripe] cancel_local_mirror_write_failed",
      expect.objectContaining({ user_id: "user_x" }),
    );
    expect(h.deliverEmail).toHaveBeenCalledTimes(1);
  });
});
