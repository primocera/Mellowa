import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signReceipt, verifyReceipt, hashUserId } from "@/lib/account-deletion/receipt";

/**
 * MW-V18-04: the deletion-status receipt is a signed, short-lived, PII-free
 * capability. It round-trips, rejects tampering and expiry, distinguishes those
 * from a server with no secret (fail closed), and never embeds a user id.
 */

const SECRET = "test-receipt-secret-000";

beforeEach(() => {
  process.env.ACCOUNT_DELETION_RECEIPT_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.ACCOUNT_DELETION_RECEIPT_SECRET;
});

describe("signReceipt / verifyReceipt", () => {
  it("round-trips a valid receipt", () => {
    const r = signReceipt("req_1");
    expect(r).not.toBeNull();
    const check = verifyReceipt(r!.token);
    expect(check).toEqual({ ok: true, requestId: "req_1" });
  });

  it("embeds no user id or PII — only the request id and expiry", () => {
    const r = signReceipt("req_abc")!;
    const [id, exp, mac] = r.token.split(".");
    expect(id).toBe("req_abc");
    expect(Number.isInteger(Number(exp))).toBe(true);
    expect(mac).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(r.token).not.toContain("@");
  });

  it("rejects a tampered request id (bad_signature)", () => {
    const r = signReceipt("req_1")!;
    const [, exp, mac] = r.token.split(".");
    const forged = `req_2.${exp}.${mac}`;
    expect(verifyReceipt(forged)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered expiry (bad_signature)", () => {
    const r = signReceipt("req_1")!;
    const [id, exp, mac] = r.token.split(".");
    const forged = `${id}.${Number(exp) + 10_000}.${mac}`;
    expect(verifyReceipt(forged)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired but otherwise-valid receipt", () => {
    const now = Date.now();
    const r = signReceipt("req_1", 60, now)!;
    const later = now + 61_000;
    expect(verifyReceipt(r.token, later)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a malformed token", () => {
    expect(verifyReceipt("not-a-token").ok).toBe(false);
    expect(verifyReceipt("a.b").ok).toBe(false);
    expect(verifyReceipt("a.notanumber.c")).toEqual({ ok: false, reason: "malformed" });
  });

  it("fails closed when no signing secret is configured", () => {
    delete process.env.ACCOUNT_DELETION_RECEIPT_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(signReceipt("req_1")).toBeNull();
    expect(verifyReceipt("x.1.y")).toEqual({ ok: false, reason: "not_configured" });
  });

  it("falls back to the service-role key when no dedicated secret is set", () => {
    delete process.env.ACCOUNT_DELETION_RECEIPT_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "srk-fallback";
    const r = signReceipt("req_1");
    expect(r).not.toBeNull();
    expect(verifyReceipt(r!.token).ok).toBe(true);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
});

describe("hashUserId", () => {
  it("is deterministic and non-reversible (sha256 hex)", () => {
    expect(hashUserId("u1")).toBe(hashUserId("u1"));
    expect(hashUserId("u1")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUserId("u1")).not.toBe(hashUserId("u2"));
    expect(hashUserId("u1")).not.toContain("u1");
  });
});
