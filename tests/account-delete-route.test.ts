import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-V17-04: account deletion is transactional and true.
 *
 * The confirmation email and the `account_deleted` event are recorded ONLY after
 * the identity is deleted AND verified gone; a failed or unverified deletion
 * sends neither. On a shared Stripe account a subscription is cancelled only
 * after proving Mellowa ownership — a foreign/wrong-user/untagged object is never
 * mutated and never deleted over.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "person@example.com" } as { id: string; email: string | null } | null,
  subRead: { data: null as Row | null, error: null as Row | null },
  ownership: { kind: "owned", customerId: "cus_1" } as { kind: string; customerId?: string },
  deleteError: null as Row | null,
  getUserResult: { data: { user: null as Row | null } },
  canceled: [] as string[],
  cancelThrow: null as Error | null,
  tracked: [] as Array<{ event: string; opts: { userId: string | null; properties?: Row } }>,
  emails: [] as Array<{ eventKey: string; userId: string | null; to: string }>,
  signedOut: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user } }),
      signOut: async () => {
        h.signedOut++;
      },
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => h.subRead }),
      }),
    }),
    auth: {
      admin: {
        deleteUser: async () => ({ error: h.deleteError }),
        getUserById: async () => h.getUserResult,
      },
    },
  }),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    subscriptions: {
      cancel: async (id: string) => {
        if (h.cancelThrow) throw h.cancelThrow;
        h.canceled.push(id);
        return {};
      },
    },
  }),
}));

vi.mock("@/lib/stripe/customer", () => ({
  verifyMellowaCustomerOwnership: async () => h.ownership,
}));

vi.mock("@/lib/privacy/registry", () => ({ USER_DATA_REGISTRY: [] }));

vi.mock("@/lib/analytics", () => ({
  trackEvent: (event: string, opts: { userId: string | null; properties?: Row }) =>
    h.tracked.push({ event, opts }),
}));

vi.mock("@/lib/email/deliver", () => ({
  deliverEmail: async (args: { eventKey: string; userId: string | null; to: string }) => {
    h.emails.push({ eventKey: args.eventKey, userId: args.userId, to: args.to });
  },
}));

vi.mock("@/lib/email/templates", () => ({
  accountDeletedEmail: () => ({ subject: "s", html: "<p>h</p>" }),
}));

import { POST } from "@/app/api/account/delete/route";

const body = () =>
  new Request("http://x/api/account/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: "DELETE" }),
  });

beforeEach(() => {
  h.user = { id: "u1", email: "person@example.com" };
  h.subRead = { data: null, error: null };
  h.ownership = { kind: "owned", customerId: "cus_1" };
  h.deleteError = null;
  h.getUserResult = { data: { user: null } };
  h.canceled = [];
  h.cancelThrow = null;
  h.tracked = [];
  h.emails = [];
  h.signedOut = 0;
});

describe("POST /api/account/delete", () => {
  it("401 when unauthenticated — no email, no event", async () => {
    h.user = null;
    const res = await POST(body());
    expect(res.status).toBe(401);
    expect(h.emails).toEqual([]);
    expect(h.tracked).toEqual([]);
  });

  it("fails closed (503) when the subscription read errors — no deletion", async () => {
    h.subRead = { data: null, error: { code: "PGRST500" } };
    const res = await POST(body());
    expect(res.status).toBe(503);
    expect(h.emails).toEqual([]);
    expect(h.tracked).toEqual([]);
  });

  it("verified deletion queues exactly one email and one null-user event", async () => {
    const res = await POST(body());
    expect(res.status).toBe(200);
    expect(h.emails).toEqual([
      { eventKey: "account_deleted:u1", userId: null, to: "person@example.com" },
    ]);
    expect(h.tracked).toHaveLength(1);
    expect(h.tracked[0].event).toBe("account_deleted");
    expect(h.tracked[0].opts.userId).toBeNull();
    expect(h.signedOut).toBe(1);
  });

  it("if auth deletion fails, NO email and NO event are recorded", async () => {
    h.deleteError = { message: "boom" };
    const res = await POST(body());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("delete_failed");
    expect(h.emails).toEqual([]);
    expect(h.tracked).toEqual([]);
  });

  it("if the identity still exists after delete, it is unverified — NO email/event", async () => {
    h.getUserResult = { data: { user: { id: "u1" } } };
    const res = await POST(body());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("delete_unverified");
    expect(h.emails).toEqual([]);
    expect(h.tracked).toEqual([]);
  });

  it("cancels an owned live subscription before deleting", async () => {
    h.subRead = { data: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "active" }, error: null };
    h.ownership = { kind: "owned", customerId: "cus_1" };
    const res = await POST(body());
    expect(res.status).toBe(200);
    expect(h.canceled).toEqual(["sub_1"]);
    expect(h.emails).toHaveLength(1);
  });

  it("never cancels or deletes over a foreign/wrong-user/untagged customer", async () => {
    h.subRead = { data: { stripe_subscription_id: "sub_x", stripe_customer_id: "cus_foreign", status: "active" }, error: null };
    h.ownership = { kind: "mismatch" };
    const res = await POST(body());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("billing_reconciliation_required");
    expect(h.canceled).toEqual([]);
    expect(h.emails).toEqual([]);
    expect(h.tracked).toEqual([]);
  });

  it("fails closed (503) when ownership can't be verified transiently", async () => {
    h.subRead = { data: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", status: "active" }, error: null };
    h.ownership = { kind: "unavailable" };
    const res = await POST(body());
    expect(res.status).toBe(503);
    expect(h.canceled).toEqual([]);
    expect(h.emails).toEqual([]);
  });

  it("aborts (409) when a live subscription has no stored customer to verify", async () => {
    h.subRead = { data: { stripe_subscription_id: "sub_1", stripe_customer_id: null, status: "active" }, error: null };
    const res = await POST(body());
    expect(res.status).toBe(409);
    expect(h.canceled).toEqual([]);
    expect(h.emails).toEqual([]);
  });
});
