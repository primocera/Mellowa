import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MELLOWA_APP,
  customerIdempotencyKey,
  findMellowaCustomer,
} from "@/lib/stripe/customer";

/**
 * MW-02: idempotent, Mellowa-owned Stripe customer creation.
 *
 * The acceptance bar the pack sets: "No checkout session on the first failure is
 * insufficient evidence of idempotent customer creation" — the proof must cover
 * a SECOND request after a failed write. These tests cover that plus the
 * recovery, multiple-candidate and foreign-candidate outcomes.
 */

// ── The recovery helper in isolation (real code, mocked Stripe boundary) ──────

type SearchData = { data: unknown[] };

function stripeWithSearch(
  result: SearchData | (() => never)
): Parameters<typeof findMellowaCustomer>[0] {
  return {
    customers: {
      search: async () =>
        typeof result === "function" ? result() : result,
    },
  } as unknown as Parameters<typeof findMellowaCustomer>[0];
}

describe("findMellowaCustomer — explicit ownership recovery", () => {
  it("returns `none` when no Mellowa customer exists (safe to create)", async () => {
    const r = await findMellowaCustomer(stripeWithSearch({ data: [] }), "u1");
    expect(r).toEqual({ kind: "none" });
  });

  it("returns `found` and reuses the single existing customer", async () => {
    const r = await findMellowaCustomer(
      stripeWithSearch({ data: [{ id: "cus_A" }] }),
      "u1"
    );
    expect(r).toEqual({ kind: "found", customerId: "cus_A" });
  });

  it("fails closed with `multiple` when two live customers exist for one user", async () => {
    const r = await findMellowaCustomer(
      stripeWithSearch({ data: [{ id: "cus_A" }, { id: "cus_B" }] }),
      "u1"
    );
    expect(r).toEqual({ kind: "multiple", customerIds: ["cus_A", "cus_B"] });
  });

  it("excludes a deleted customer rather than reusing it", async () => {
    const r = await findMellowaCustomer(
      stripeWithSearch({ data: [{ id: "cus_dead", deleted: true }] }),
      "u1"
    );
    expect(r).toEqual({ kind: "none" });
  });

  it("returns `unavailable` (never `none`) when the lookup throws", async () => {
    const r = await findMellowaCustomer(
      stripeWithSearch(() => {
        throw new Error("stripe search 500");
      }),
      "u1"
    );
    expect(r).toEqual({ kind: "unavailable" });
  });
});

describe("customerIdempotencyKey — stable and non-PII", () => {
  it("is deterministic for the same user across retries", () => {
    expect(customerIdempotencyKey("u1")).toBe(customerIdempotencyKey("u1"));
  });
  it("is namespaced and carries no email/PII", () => {
    const key = customerIdempotencyKey("u1");
    expect(key).toBe("mellowa_customer_u1");
    expect(key).not.toContain("@");
  });
});

// ── Route-level: create args, recovery reuse, multiple fail-closed ────────────

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  subRead: { data: null as Row | null, error: null as Row | null },
  // Successive `maybeSingle()` results (initial read, then confirm re-read). When
  // exhausted, the last entry repeats — so the default single-value behaviour is
  // unchanged for tests that don't set a queue.
  reads: null as Array<{ data: Row | null; error: Row | null }> | null,
  searchResult: { data: [] as unknown[] },
  // Ownership retrieve, keyed by customer id, so a test can make the stored id
  // owned while the concurrent-winner id is foreign, etc. Default: every id is
  // an owned Mellowa customer.
  retrieveById: ((id: string) => ({
    id,
    metadata: { app: MELLOWA_APP, supabase_user_id: "u1" },
  })) as (id: string) => Row | (() => never),
  createOpts: undefined as unknown,
  createArgs: undefined as Row | undefined,
  sessionCustomer: undefined as string | undefined,
  stripeCalls: [] as string[],
  errorLogs: [] as unknown[][],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "u1",
            email: "secret.person@example.com",
            email_confirmed_at: "2026-01-01T00:00:00Z",
          },
        },
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (h.reads && h.reads.length > 0) {
              return h.reads.length > 1 ? h.reads.shift()! : h.reads[0];
            }
            return h.subRead;
          },
        }),
      }),
      upsert: async () => ({ error: null }),
      update: () => ({ eq: () => ({ select: async () => ({ data: [{ user_id: "u1" }], error: null }) }) }),
    }),
  }),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    customers: {
      search: async () => h.searchResult,
      // MW-95-01: the ownership predicate retrieves every id (recovered/created)
      // before Checkout. Default to an owned Mellowa customer so the idempotency
      // assertions exercise the happy path; ownership-failure paths are covered
      // in customer-ownership.test.ts.
      retrieve: async (id: string) => {
        const r = h.retrieveById(id);
        return typeof r === "function" ? r() : r;
      },
      create: async (args: Row, opts: unknown) => {
        h.stripeCalls.push("customers.create");
        h.createArgs = args;
        h.createOpts = opts;
        return { id: "cus_created" };
      },
    },
    checkout: {
      sessions: {
        create: async (args: { customer?: string }) => {
          h.stripeCalls.push("checkout.sessions.create");
          h.sessionCustomer = args?.customer;
          return { url: "https://stripe.test/s" };
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

function req() {
  return new Request("https://app.test/api/stripe/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ interval: "monthly" }),
  });
}

beforeEach(() => {
  h.subRead = { data: null, error: null };
  h.reads = null;
  h.retrieveById = (id: string) => ({
    id,
    metadata: { app: MELLOWA_APP, supabase_user_id: "u1" },
  });
  h.searchResult = { data: [] };
  h.createOpts = undefined;
  h.createArgs = undefined;
  h.sessionCustomer = undefined;
  h.stripeCalls = [];
  h.errorLogs = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    h.errorLogs.push(a);
  });
});

describe("checkout creates one idempotent, Mellowa-owned customer", () => {
  it("passes a stable non-PII idempotency key and app-ownership metadata on create", async () => {
    await POST(req());
    expect(h.stripeCalls).toContain("customers.create");
    expect((h.createOpts as { idempotencyKey?: string }).idempotencyKey).toBe(
      "mellowa_customer_u1"
    );
    const meta = (h.createArgs as { metadata?: Row }).metadata ?? {};
    expect(meta.supabase_user_id).toBe("u1");
    expect(meta.app).toBe(MELLOWA_APP);
  });

  it("a retry produces the SAME idempotency key (no second customer)", async () => {
    await POST(req());
    const first = (h.createOpts as { idempotencyKey?: string }).idempotencyKey;
    h.createOpts = undefined;
    await POST(req());
    const second = (h.createOpts as { idempotencyKey?: string }).idempotencyKey;
    expect(second).toBe(first);
  });

  it("reuses a recovered orphan customer instead of creating a second", async () => {
    h.searchResult = { data: [{ id: "cus_orphan" }] };
    const res = await POST(req());
    expect(res.status).toBe(200);
    // No create — the recovered customer is reused straight into checkout.
    expect(h.stripeCalls).toEqual(["checkout.sessions.create"]);
  });

  it("fails closed (no create, no session) when multiple owned candidates exist", async () => {
    h.searchResult = { data: [{ id: "cus_A" }, { id: "cus_B" }] };
    const res = await POST(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("customer_reconciliation_required");
    expect(body.retryable).toBe(false);
    expect(h.stripeCalls).toEqual([]);
  });

  it("logs ids only for reconciliation — never the customer's email", async () => {
    h.searchResult = { data: [{ id: "cus_A" }, { id: "cus_B" }] };
    await POST(req());
    const flat = JSON.stringify(h.errorLogs);
    expect(flat).toContain("cus_A");
    expect(flat).not.toContain("secret.person@example.com");
  });
});

// ── MW-95-01: ownership predicate on the STORED-row customer id ───────────────

function throwsCode(code: string): () => never {
  return () => {
    throw Object.assign(new Error(code), { code });
  };
}

/** A canceled payer who already used a trial: entitlement allows a fresh
 * checkout, no trial is offered, and the STORED customer id is reused. */
function storedRow(customerId: string): Row {
  return {
    status: "canceled",
    trial_used_at: "2026-05-01T00:00:00Z",
    stripe_customer_id: customerId,
  };
}

describe("checkout verifies ownership of the STORED customer id before reuse", () => {
  it("owned stored id → reused straight into checkout, no create", async () => {
    h.subRead = { data: storedRow("cus_stored"), error: null };
    h.retrieveById = (id) => ({
      id,
      metadata: { app: MELLOWA_APP, supabase_user_id: "u1" },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.stripeCalls).toEqual(["checkout.sessions.create"]);
    expect(h.sessionCustomer).toBe("cus_stored");
  });

  it("foreign-app stored id → 503 reconciliation, no create, no session", async () => {
    h.subRead = { data: storedRow("cus_foreign"), error: null };
    h.retrieveById = (id) => ({
      id,
      metadata: { app: "launchbloom", supabase_user_id: "u1" },
    });
    const res = await POST(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("customer_reconciliation_required");
    expect(body.retryable).toBe(false);
    expect(h.stripeCalls).toEqual([]);
  });

  it("correct-app / wrong-user stored id → 503 reconciliation", async () => {
    h.subRead = { data: storedRow("cus_wu"), error: null };
    h.retrieveById = (id) => ({
      id,
      metadata: { app: MELLOWA_APP, supabase_user_id: "not_u1" },
    });
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("customer_reconciliation_required");
    expect(h.stripeCalls).toEqual([]);
  });

  it("resource_missing stored id → recovers (search→create) and opens checkout", async () => {
    // Initial read: stored id points at a gone customer. After recovery links
    // cus_created, the confirm re-read reflects the new link (no race winner).
    h.reads = [
      { data: storedRow("cus_gone"), error: null },
      { data: { stripe_customer_id: "cus_created" }, error: null },
    ];
    h.searchResult = { data: [] };
    h.retrieveById = (id) =>
      id === "cus_gone"
        ? throwsCode("resource_missing")
        : { id, metadata: { app: MELLOWA_APP, supabase_user_id: "u1" } };
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.stripeCalls).toEqual([
      "customers.create",
      "checkout.sessions.create",
    ]);
    expect(h.sessionCustomer).toBe("cus_created");
  });

  it("transient retrieve failure on the stored id → 503 billing_unavailable (retryable)", async () => {
    h.subRead = { data: storedRow("cus_stored"), error: null };
    h.retrieveById = () => throwsCode("api_connection_error");
    const res = await POST(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("billing_unavailable");
    expect(body.retryable).toBe(true);
    expect(h.stripeCalls).toEqual([]);
  });
});

describe("checkout verifies ownership of the concurrent-WINNER id before adopting", () => {
  // New customer path: initial read null → create cus_created → link → confirm
  // re-read returns a DIFFERENT id (a concurrent request won the race).
  it("owned winner → adopted; checkout opens on the winner, not our create", async () => {
    h.reads = [
      { data: null, error: null },
      { data: { stripe_customer_id: "cus_winner" }, error: null },
    ];
    h.retrieveById = (id) => ({
      id,
      metadata: { app: MELLOWA_APP, supabase_user_id: "u1" },
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.sessionCustomer).toBe("cus_winner");
  });

  it("foreign-app winner → 503 reconciliation, no session", async () => {
    h.reads = [
      { data: null, error: null },
      { data: { stripe_customer_id: "cus_winner" }, error: null },
    ];
    h.retrieveById = (id) =>
      id === "cus_winner"
        ? { id, metadata: { app: "launchbloom", supabase_user_id: "u1" } }
        : { id, metadata: { app: MELLOWA_APP, supabase_user_id: "u1" } };
    const res = await POST(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("customer_reconciliation_required");
    expect(body.retryable).toBe(false);
    expect(h.stripeCalls).not.toContain("checkout.sessions.create");
  });

  it("transient retrieve failure on the winner → 503 billing_unavailable (retryable)", async () => {
    h.reads = [
      { data: null, error: null },
      { data: { stripe_customer_id: "cus_winner" }, error: null },
    ];
    h.retrieveById = (id) =>
      id === "cus_winner"
        ? throwsCode("api_connection_error")
        : { id, metadata: { app: MELLOWA_APP, supabase_user_id: "u1" } };
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("billing_unavailable");
    expect(h.stripeCalls).not.toContain("checkout.sessions.create");
  });
});
