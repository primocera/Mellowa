import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Request-flood protection for the unauthenticated auth endpoints (signup,
 * password reset, resend verification).
 *
 * Storage is durable and shared across serverless instances: the
 * `public.claim_auth_rate_limit(p_bucket, p_limit, p_window_seconds)` RPC
 * (migration 055, SECURITY DEFINER, service_role only) atomically records a hit
 * when it is allowed and returns 0, or returns the seconds until the oldest hit
 * in the window expires (> 0) — used directly as Retry-After.
 *
 * Privacy: buckets never contain a raw IP or email address — only
 * `<prefix>:<sha256 hex>` of the client IP or of the trimmed, lowercased email.
 *
 * Fail closed: if the limiter cannot be consulted (RPC error, unexpected
 * result, missing service config), the request is refused with a calm 503
 * rather than allowed through unmetered.
 */

export interface AuthRateRule {
  prefix: "signup_ip" | "signup_email" | "reset_email" | "resend_email";
  limit: number;
  windowSeconds: number;
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export const AUTH_RATE_LIMITS = {
  /** Signup attempts per client IP. */
  signupIp: { prefix: "signup_ip", limit: 5, windowSeconds: HOUR },
  /** Signup attempts per email address. */
  signupEmail: { prefix: "signup_email", limit: 3, windowSeconds: DAY },
  /** Password-reset requests per email address. */
  resetEmail: { prefix: "reset_email", limit: 3, windowSeconds: HOUR },
  /** Verification-resend requests per email address. */
  resendEmail: { prefix: "resend_email", limit: 3, windowSeconds: HOUR },
} as const satisfies Record<string, AuthRateRule>;

export const RATE_LIMITED_MESSAGE =
  "Too many attempts just now. Please wait a little and try again.";
export const LIMITER_UNAVAILABLE_MESSAGE =
  "We couldn't process that just now. Please try again shortly.";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailBucket(rule: AuthRateRule, email: string): string {
  return `${rule.prefix}:${sha256Hex(normalizeEmail(email))}`;
}

export function ipBucket(rule: AuthRateRule, ip: string): string {
  return `${rule.prefix}:${sha256Hex(ip.trim().toLowerCase())}`;
}

/**
 * The caller's IP as seen by the platform: the first `x-forwarded-for` entry
 * (Vercel sets it to the real client), else `x-real-ip`. Null when neither is
 * present (local dev); callers then share one "unknown" IP bucket.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}

export type RateLimitOutcome =
  | { ok: true }
  | { ok: false; reason: "limited"; retryAfterSeconds: number }
  | { ok: false; reason: "unavailable" };

/** Claims one hit in `bucket` under `rule`. Fails closed on any doubt. */
export async function claimAuthRateLimit(
  bucket: string,
  rule: AuthRateRule
): Promise<RateLimitOutcome> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("claim_auth_rate_limit", {
      p_bucket: bucket,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) {
      console.error("[auth/rate-limit] claim failed", { prefix: rule.prefix, code: error.code });
      return { ok: false, reason: "unavailable" };
    }
    const retryAfter = typeof data === "number" ? data : Number(data);
    if (!Number.isFinite(retryAfter) || retryAfter < 0) {
      console.error("[auth/rate-limit] unexpected claim result", { prefix: rule.prefix });
      return { ok: false, reason: "unavailable" };
    }
    if (retryAfter === 0) return { ok: true };
    return { ok: false, reason: "limited", retryAfterSeconds: Math.max(1, Math.ceil(retryAfter)) };
  } catch (err) {
    console.error("[auth/rate-limit] claim threw", {
      prefix: rule.prefix,
      message: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Claims each (bucket, rule) in order and stops at the first refusal. Returns
 * the refusal as a ready response, or null when every claim was allowed.
 */
export async function enforceAuthRateLimits(
  claims: Array<{ bucket: string; rule: AuthRateRule }>
): Promise<NextResponse | null> {
  for (const { bucket, rule } of claims) {
    const outcome = await claimAuthRateLimit(bucket, rule);
    if (outcome.ok) continue;
    if (outcome.reason === "limited") return rateLimitedResponse(outcome.retryAfterSeconds);
    return limiterUnavailableResponse();
  }
  return null;
}

export function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "rate_limited", user_message: RATE_LIMITED_MESSAGE, retry_after: retryAfterSeconds },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" },
    }
  );
}

export function limiterUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "unavailable", user_message: LIMITER_UNAVAILABLE_MESSAGE },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
