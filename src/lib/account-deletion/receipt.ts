import "server-only";
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Short-lived signed receipt for account-deletion status lookup (MW-V18-04).
 *
 * Once the auth identity is deleted, a retried request can no longer authenticate
 * — yet the client still needs to learn the outcome ("in progress" / "completed").
 * The receipt solves this WITHOUT exposing any PII: it binds only the opaque
 * request id and an expiry, signed with a server secret. A status endpoint
 * verifies the signature and returns a coarse status only.
 *
 * Format: `<requestId>.<expEpochSeconds>.<hmacBase64url>`. No user id, no email,
 * nothing sensitive — a leaked receipt reveals only that *some* deletion job
 * exists and its coarse state, and only until it expires.
 */

const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(requestId: string, exp: number, secret: string): string {
  return b64url(createHmac("sha256", secret).update(`${requestId}.${exp}`).digest());
}

export interface Receipt {
  token: string;
  expiresAt: number;
}

/**
 * Mint a receipt for `requestId`. Returns null when no signing secret is
 * configured (fail closed — the caller must treat a missing receipt as
 * "no signed status channel", never as success).
 */
export function signReceipt(
  requestId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  now: number = Date.now()
): Receipt | null {
  const secret = serverEnv.accountDeletionReceiptSecret;
  if (!secret) return null;
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const mac = sign(requestId, exp, secret);
  return { token: `${requestId}.${exp}.${mac}`, expiresAt: exp };
}

export type ReceiptCheck =
  | { ok: true; requestId: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "not_configured" };

/**
 * Verify a receipt. Constant-time signature check; distinguishes an expired but
 * otherwise-valid receipt from a tampered one, and both from a server that has
 * no signing secret (fail closed, never "ok").
 */
export function verifyReceipt(token: string, now: number = Date.now()): ReceiptCheck {
  const secret = serverEnv.accountDeletionReceiptSecret;
  if (!secret) return { ok: false, reason: "not_configured" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [requestId, expRaw, mac] = parts;
  const exp = Number(expRaw);
  if (!requestId || !Number.isInteger(exp)) return { ok: false, reason: "malformed" };

  const expected = sign(requestId, exp, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  // Signature is valid — only now is it safe to trust the embedded expiry.
  if (Math.floor(now / 1000) >= exp) return { ok: false, reason: "expired" };
  return { ok: true, requestId };
}

/** Deterministic, non-reversible correlation hash of a user id for audit. */
export function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}
