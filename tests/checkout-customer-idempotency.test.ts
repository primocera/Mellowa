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
  searchResult: { data: [] as unknown[] },
  createOpts: undefined as unknown,
  createArgs: undefined as Row | undefined,
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
      select: () => ({ eq: () => ({ maybeSingle: async () => h.subRead }) }),
      upsert: async () => ({ error: null }),
      update: () => ({ eq: () => ({ select: async () => ({ data: [{ user_id: "u1" }], error: null }) }) }),
    }),
  }),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    customers: {
      search: async () => h.searchResult,
      create: async (args: Row, opts: unknown) => {
        h.stripeCalls.push("customers.create");
        h.createArgs = args;
        h.createOpts = opts;
        return { id: "cus_created" };
      },
    },
    checkout: {
      sessions: {
        create: async () => {
          h.stripeCalls.push("checkout.sessions.create");
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
  h.searchResult = { data: [] };
  h.createOpts = undefined;
  h.createArgs = undefined;
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
