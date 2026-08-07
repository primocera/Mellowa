import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MELLOWA_APP,
  verifyMellowaCustomerOwnership,
  type CustomerOwnership,
} from "@/lib/stripe/customer";

/**
 * XAPP-95-01 (Mellowa side): the consolidated cross-app ownership matrix.
 *
 * MW-95-01 built the ownership predicate and applied it at every checkout/portal
 * boundary, including the durable stored-DB-link and concurrent-race-winner paths
 * this prompt requires. Here that predicate is exercised as ONE object×source
 * matrix against the SHARED Stripe account, and the sanitized matrix document is
 * pinned to the code constant (MELLOWA_APP) so the metadata spelling is never
 * hand-maintained separately. Synthetic opaque IDs only; no live Stripe.
 */

const USER = "user-opaque-1";

function stripeRetrieving(customer: Record<string, unknown> | (() => never)) {
  return {
    customers: {
      retrieve: async () =>
        typeof customer === "function" ? customer() : customer,
    },
  } as unknown as Parameters<typeof verifyMellowaCustomerOwnership>[0];
}

function throwsCode(code: string): () => never {
  return () => {
    throw Object.assign(new Error(code), { code });
  };
}

// ── The object×source matrix over the single ownership predicate ──────────────

describe("cross-app ownership matrix — only exact Mellowa metadata is owned", () => {
  const owned = { kind: "owned", customerId: "cus_x" } as const;
  const cases: Array<{
    name: string;
    customer: Record<string, unknown> | (() => never);
    expected: CustomerOwnership;
  }> = [
    {
      name: "Mellowa customer (app=mellowa + our user) → owned",
      customer: { id: "cus_x", metadata: { app: MELLOWA_APP, supabase_user_id: USER } },
      expected: owned,
    },
    {
      name: "foreign source=launchbloom, SAME user id → never owned",
      customer: {
        id: "cus_x",
        metadata: { source: "launchbloom", app_user_id: USER, supabase_user_id: USER },
      },
      expected: { kind: "mismatch" },
    },
    {
      name: "correct app, WRONG user → mismatch",
      customer: { id: "cus_x", metadata: { app: MELLOWA_APP, supabase_user_id: "someone-else" } },
      expected: { kind: "mismatch" },
    },
    {
      name: "missing metadata entirely → mismatch",
      customer: { id: "cus_x", metadata: {} },
      expected: { kind: "mismatch" },
    },
    {
      name: "deleted foreign/owned customer → missing (never chargeable)",
      customer: { id: "cus_x", deleted: true, metadata: { app: MELLOWA_APP, supabase_user_id: USER } },
      expected: { kind: "missing" },
    },
    {
      name: "durable link points at a gone customer → missing (recoverable)",
      customer: throwsCode("resource_missing"),
      expected: { kind: "missing" },
    },
    {
      name: "transient retrieve failure → unavailable (fail closed, observable)",
      customer: throwsCode("api_connection_error"),
      expected: { kind: "unavailable" },
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const result = await verifyMellowaCustomerOwnership(
        stripeRetrieving(c.customer),
        "cus_x",
        USER
      );
      expect(result).toEqual(c.expected);
    });
  }

  it("a foreign or unresolved customer NEVER yields an owned verdict", async () => {
    const foreigns = [
      { id: "c", metadata: { source: "launchbloom", supabase_user_id: USER } },
      { id: "c", metadata: { app: "frost", supabase_user_id: USER } },
      { id: "c", metadata: { app: MELLOWA_APP, supabase_user_id: "other" } },
      { id: "c", metadata: {} },
    ];
    for (const f of foreigns) {
      const r = await verifyMellowaCustomerOwnership(stripeRetrieving(f), "c", USER);
      expect(r.kind, JSON.stringify(f.metadata)).not.toBe("owned");
    }
  });
});

// ── Boundary application: the durable-link and race-winner paths use it ───────

describe("the checkout route applies the predicate at every customer boundary", () => {
  const route = readFileSync("src/app/api/stripe/checkout/route.ts", "utf8");

  it("verifies the STORED durable customer id before reuse", () => {
    expect(route).toContain("verifyMellowaCustomerOwnership(stripe, customerId, user.id)");
    expect(route).toMatch(/source: "stored_row"/);
  });

  it("verifies the recovered/created id before Checkout", () => {
    expect(route).toContain("customer_ownership_unverified_after_recovery");
  });

  it("verifies the concurrent-race WINNER before adopting another request's row", () => {
    expect(route).toMatch(/source: "concurrent_winner"/);
    expect(route).toContain("customerId = winnerOwned.customerId");
  });

  it("the portal opens only on an owned customer", () => {
    const portal = readFileSync("src/app/api/stripe/portal/route.ts", "utf8");
    expect(portal).toContain("verifyMellowaCustomerOwnership");
    expect(portal).toMatch(/owned\.kind !== "owned"/);
  });
});

// ── The sanitized matrix doc is pinned to the tested constant ─────────────────

describe("the ownership matrix document is not hand-maintained separately", () => {
  const doc = readFileSync("docs/release/v16/XAPP-OWNERSHIP-MATRIX.md", "utf8");

  it("uses the exact MELLOWA_APP spelling from code", () => {
    expect(doc).toContain(`\`${MELLOWA_APP}\``);
    // The negative source token is Scalvya's, documented but never matched here.
    expect(doc).toContain("launchbloom");
  });

  it("carries no email, production id or customer content — synthetic ids only", () => {
    expect(doc).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/); // no email
    expect(doc).not.toMatch(/\bsk_(live|test)_/); // no secret key
    expect(doc).not.toMatch(/\bcus_[A-Za-z0-9]{8,}\b/); // no real-looking customer id
  });

  it("names the durable-link and race-winner paths this prompt required", () => {
    expect(doc).toMatch(/stored DB link/i);
    expect(doc).toMatch(/concurrent race winner/i);
  });
});
