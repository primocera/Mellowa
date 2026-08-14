import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-V18-04: the delete route records ONE durable job and (by default) drives a
 * single best-effort pass, returning an opaque request id + a signed receipt.
 *
 * It no longer performs the destructive steps inline-and-forget — that logic is
 * covered by account-deletion-machine.test.ts. Here we assert the route
 * contract: auth + confirmation gating, idempotent job creation, fail-closed on
 * a create error, session sign-out, the inline-pass kill switch, and a
 * PII-free receipt.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "person@example.com" } as { id: string; email: string | null } | null,
  insertResult: { data: { id: "req_1" } as Row | null, error: null as Row | null },
  existingResult: { data: { id: "req_existing" } as Row | null, error: null as Row | null },
  syncEnabled: true,
  processed: [] as string[],
  processReturn: { status: "completed" } as { status: string } | null,
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
      insert: () => ({
        select: () => ({ maybeSingle: async () => h.insertResult }),
      }),
      select: () => ({
        eq: () => ({ maybeSingle: async () => h.existingResult }),
      }),
    }),
  }),
}));

vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (flag: string) => (flag === "account_deletion_sync" ? h.syncEnabled : true),
}));

vi.mock("@/lib/account-deletion/worker", () => ({
  processJobById: async (id: string) => {
    h.processed.push(id);
    return h.processReturn;
  },
}));

process.env.ACCOUNT_DELETION_RECEIPT_SECRET = "test-secret-route";

import { POST } from "@/app/api/account/delete/route";
import { verifyReceipt } from "@/lib/account-deletion/receipt";

const body = (payload: unknown = { confirm: "DELETE" }) =>
  new Request("http://x/api/account/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

beforeEach(() => {
  h.user = { id: "u1", email: "person@example.com" };
  h.insertResult = { data: { id: "req_1" }, error: null };
  h.existingResult = { data: { id: "req_existing" }, error: null };
  h.syncEnabled = true;
  h.processed = [];
  h.processReturn = { status: "completed" };
  h.signedOut = 0;
});

afterAll(() => {
  delete process.env.ACCOUNT_DELETION_RECEIPT_SECRET;
});

describe("POST /api/account/delete (durable)", () => {
  it("401 when unauthenticated — no job, no sign-out", async () => {
    h.user = null;
    const res = await POST(body());
    expect(res.status).toBe(401);
    expect(h.processed).toEqual([]);
    expect(h.signedOut).toBe(0);
  });

  it("400 when the DELETE confirmation is missing", async () => {
    const res = await POST(body({ confirm: "nope" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("confirmation_required");
    expect(h.processed).toEqual([]);
  });

  it("creates a job, signs out, drives one pass, returns a valid receipt", async () => {
    const res = await POST(body());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.requestId).toBe("req_1");
    expect(json.status).toBe("completed");
    expect(h.processed).toEqual(["req_1"]);
    expect(h.signedOut).toBe(1);

    // Receipt verifies and carries only the request id.
    const check = verifyReceipt(json.receipt);
    expect(check).toEqual({ ok: true, requestId: "req_1" });
  });

  it("does NOT run the inline pass when the kill switch is off", async () => {
    h.syncEnabled = false;
    const res = await POST(body());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("requested");
    expect(h.processed).toEqual([]);
    // Job still created and receipt still minted — cron will finish it.
    expect(json.requestId).toBe("req_1");
    expect(json.receipt).toBeTruthy();
  });

  it("is idempotent: a duplicate (unique violation) returns the existing job", async () => {
    h.insertResult = { data: null, error: { code: "23505" } };
    const res = await POST(body());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.requestId).toBe("req_existing");
    expect(h.processed).toEqual(["req_existing"]);
  });

  it("fails closed (503) when the job cannot be created", async () => {
    h.insertResult = { data: null, error: { code: "PGRST500" } };
    const res = await POST(body());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("deletion_unavailable");
    expect(h.processed).toEqual([]);
    expect(h.signedOut).toBe(0);
  });
});
