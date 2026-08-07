import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MELLOWA_APP,
  verifyMellowaCustomerOwnership,
  type CustomerOwnership,
} from "@/lib/stripe/customer";

/**
 * MW-95-01: a stored/searched/recovered Stripe customer id is NOT ownership
 * proof on the SHARED Stripe account (Mellowa + Scalvya/LaunchBloom + Frost).
 * `verifyMellowaCustomerOwnership` is the single predicate every checkout and
 * portal boundary runs before an id can be charged or managed. Ownership is
 * EXACT metadata: `app === "mellowa"` AND `supabase_user_id === userId`.
 * Presence of the id in Mellowa's own table, or a shared email, is never proof.
 */

type RetrieveResult = Record<string, unknown> | (() => never);

function stripeWithRetrieve(result: RetrieveResult) {
  return {
    customers: {
      retrieve: async () =>
        typeof result === "function" ? result() : result,
    },
  } as unknown as Parameters<typeof verifyMellowaCustomerOwnership>[0];
}

function throwsCode(code: string): () => never {
  return () => {
    throw Object.assign(new Error(code), { code });
  };
}

// ── Table-driven ownership predicate ─────────────────────────────────────────

describe("verifyMellowaCustomerOwnership — exact-metadata predicate", () => {
  const USER = "u1";

  const cases: Array<{
    name: string;
    retrieve: RetrieveResult;
    expected: CustomerOwnership;
  }> = [
    {
      name: "owned: app=mellowa + matching user",
      retrieve: {
        id: "cus_owned",
        metadata: { app: MELLOWA_APP, supabase_user_id: USER },
      },
      expected: { kind: "owned", customerId: "cus_owned" },
    },
    {
      name: "foreign app (launchbloom), same user → mismatch, never owned",
      retrieve: {
        id: "cus_foreign",
        metadata: { app: "launchbloom", supabase_user_id: USER },
      },
      expected: { kind: "mismatch" },
    },
    {
      name: "correct app, WRONG user → mismatch",
      retrieve: {
        id: "cus_wronguser",
        metadata: { app: MELLOWA_APP, supabase_user_id: "someone_else" },
      },
      expected: { kind: "mismatch" },
    },
    {
      name: "missing app tag → mismatch (untagged is not proof)",
      retrieve: {
        id: "cus_noapp",
        metadata: { supabase_user_id: USER },
      },
      expected: { kind: "mismatch" },
    },
    {
      name: "missing user tag → mismatch",
      retrieve: {
        id: "cus_nouser",
        metadata: { app: MELLOWA_APP },
      },
      expected: { kind: "mismatch" },
    },
    {
      name: "no metadata at all → mismatch",
      retrieve: { id: "cus_bare" },
      expected: { kind: "mismatch" },
    },
    {
      name: "deleted customer → missing (recoverable orphan, never chargeable)",
      retrieve: {
        id: "cus_dead",
        deleted: true,
        metadata: { app: MELLOWA_APP, supabase_user_id: USER },
      },
      expected: { kind: "missing" },
    },
    {
      name: "resource_missing on retrieve → missing (recoverable orphan)",
      retrieve: throwsCode("resource_missing"),
      expected: { kind: "missing" },
    },
    {
      name: "transient retrieve failure → unavailable (fail closed, retryable)",
      retrieve: throwsCode("api_connection_error"),
      expected: { kind: "unavailable" },
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const result = await verifyMellowaCustomerOwnership(
        stripeWithRetrieve(c.retrieve),
        "cus_input",
        USER
      );
      expect(result).toEqual(c.expected);
    });
  }

  it("never returns owned for a live-but-unproven customer (default deny)", async () => {
    const r = await verifyMellowaCustomerOwnership(
      stripeWithRetrieve({ id: "cus_x", metadata: {} }),
      "cus_x",
      USER
    );
    expect(r.kind).not.toBe("owned");
  });
});

// ── Portal-route parity: same predicate guards the Billing Portal ─────────────

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  subRead: { data: null as Row | null, error: null as Row | null },
  retrieve: (() => ({
    id: "cus_1",
    metadata: { app: "mellowa", supabase_user_id: "u1" },
  })) as () => Row,
  retrieveThrow: null as null | (() => never),
  portalCustomer: undefined as string | undefined,
  calls: [] as string[],
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
    }),
  }),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    customers: {
      retrieve: async (id: string) => {
        h.calls.push("customers.retrieve");
        if (h.retrieveThrow) return h.retrieveThrow();
        return { ...h.retrieve(), id };
      },
    },
    billingPortal: {
      sessions: {
        create: async ({ customer }: { customer: string }) => {
          h.calls.push("billingPortal.sessions.create");
          h.portalCustomer = customer;
          return { url: "https://stripe.test/portal" };
        },
      },
    },
  }),
}));

vi.mock("@/lib/env", () => ({ serverEnv: { appUrl: "https://app.test" } }));

import { POST as PORTAL } from "@/app/api/stripe/portal/route";

beforeEach(() => {
  h.user = { id: "u1" };
  h.subRead = { data: { stripe_customer_id: "cus_1" }, error: null };
  h.retrieve = () => ({
    id: "cus_1",
    metadata: { app: "mellowa", supabase_user_id: "u1" },
  });
  h.retrieveThrow = null;
  h.portalCustomer = undefined;
  h.calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("portal route runs the same ownership predicate before opening", () => {
  it("opens the portal on the OWNED customer", async () => {
    const res = await PORTAL();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://stripe.test/portal");
    expect(h.portalCustomer).toBe("cus_1");
  });

  it("401 when unauthenticated (no Stripe read)", async () => {
    h.user = null;
    const res = await PORTAL();
    expect(res.status).toBe(401);
    expect(h.calls).toEqual([]);
  });

  it("400 no_customer when the row has no stored id (no Stripe read)", async () => {
    h.subRead = { data: null, error: null };
    const res = await PORTAL();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("no_customer");
    expect(h.calls).toEqual([]);
  });

  it("503 customer_reconciliation_required (non-retryable) on a foreign-app customer", async () => {
    h.retrieve = () => ({
      id: "cus_1",
      metadata: { app: "launchbloom", supabase_user_id: "u1" },
    });
    const res = await PORTAL();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("customer_reconciliation_required");
    expect(body.retryable).toBe(false);
    expect(h.calls).not.toContain("billingPortal.sessions.create");
  });

  it("503 customer_reconciliation_required on a wrong-user customer", async () => {
    h.retrieve = () => ({
      id: "cus_1",
      metadata: { app: "mellowa", supabase_user_id: "other" },
    });
    const res = await PORTAL();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("customer_reconciliation_required");
    expect(body.retryable).toBe(false);
  });

  it("503 customer_reconciliation_required (non-retryable) when the id is missing/deleted", async () => {
    h.retrieveThrow = throwsCode("resource_missing");
    const res = await PORTAL();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("customer_reconciliation_required");
    expect(body.retryable).toBe(false);
    expect(h.calls).not.toContain("billingPortal.sessions.create");
  });

  it("503 billing_unavailable (retryable) on a transient retrieve failure", async () => {
    h.retrieveThrow = throwsCode("api_connection_error");
    const res = await PORTAL();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("billing_unavailable");
    expect(body.retryable).toBe(true);
    expect(h.calls).not.toContain("billingPortal.sessions.create");
  });

  it("never leaks the customer id or a raw provider message to the user", async () => {
    h.retrieve = () => ({
      id: "cus_secret",
      metadata: { app: "launchbloom", supabase_user_id: "u1" },
    });
    h.subRead = { data: { stripe_customer_id: "cus_secret" }, error: null };
    const res = await PORTAL();
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("cus_secret");
  });
});
