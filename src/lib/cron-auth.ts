import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Fail-closed bearer auth for cron/admin routes (Prompt 1, audit v5).
 *
 * - Secret missing  → 503 not_configured. No work runs, ever — a deployment
 *   that forgets the secret must not expose the endpoint.
 * - Wrong/missing bearer token → 401.
 * - Comparison is constant-time; the secret and Authorization header are
 *   never logged.
 *
 * Returns null when the request is authorized, otherwise the error response
 * the route must return immediately.
 */
export function requireBearerSecret(
  request: Request,
  secret: string | null | undefined
): NextResponse | null {
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!constantTimeEquals(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Production release guard: lists cron/admin secrets that are missing in a
 * production environment. Used by tests and the deploy checklist; routes
 * additionally fail closed at runtime via requireBearerSecret.
 */
export function missingOperationalSecrets(
  env: Record<string, string | undefined> = process.env
): string[] {
  if (env.NODE_ENV !== "production" || env.VERCEL_ENV === "preview") return [];
  const requiredNames = ["CRON_SECRET", "ADMIN_STATS_SECRET"];
  return requiredNames.filter((name) => !env[name]);
}
