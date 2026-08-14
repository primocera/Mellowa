import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-V18-04: the status endpoint verifies the signed receipt and returns ONLY a
 * coarse status. An invalid/expired/absent receipt is rejected; an unreadable
 * job fails closed to "in progress"; a purged (gone) job reads as completed.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  statusRow: { data: { status: "auth_deleted" } as Row | null, error: null as Row | null },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => h.statusRow }),
      }),
    }),
  }),
}));

process.env.ACCOUNT_DELETION_RECEIPT_SECRET = "test-secret-status";

import { GET } from "@/app/api/account/deletion-status/route";
import { signReceipt } from "@/lib/account-deletion/receipt";

const get = (receipt: string) =>
  new Request(`http://x/api/account/deletion-status?receipt=${encodeURIComponent(receipt)}`);

beforeEach(() => {
  h.statusRow = { data: { status: "auth_deleted" }, error: null };
});
afterAll(() => {
  delete process.env.ACCOUNT_DELETION_RECEIPT_SECRET;
});

describe("GET /api/account/deletion-status", () => {
  it("401 on a missing/invalid receipt — no job read", async () => {
    const res = await GET(get("garbage"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_receipt");
  });

  it("410 on an expired receipt", async () => {
    // Negative TTL mints a receipt whose expiry is already in the past.
    const expired = signReceipt("req_1", -10)!;
    const res = await GET(get(expired.token));
    expect(res.status).toBe(410);
  });

  it("returns the coarse status for a valid receipt", async () => {
    const r = signReceipt("req_1")!;
    const res = await GET(get(r.token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "auth_deleted", done: false });
  });

  it("reports done:true when status is completed", async () => {
    h.statusRow = { data: { status: "completed" }, error: null };
    const r = signReceipt("req_1")!;
    const res = await GET(get(r.token));
    expect(await res.json()).toEqual({ status: "completed", done: true });
  });

  it("treats a purged (gone) job as completed", async () => {
    h.statusRow = { data: null, error: null };
    const r = signReceipt("req_1")!;
    const res = await GET(get(r.token));
    expect(await res.json()).toEqual({ status: "completed", done: true });
  });

  it("fails closed to in-progress when the job read errors", async () => {
    h.statusRow = { data: null, error: { code: "PGRST500" } };
    const r = signReceipt("req_1")!;
    const res = await GET(get(r.token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "requested", done: false });
  });
});
