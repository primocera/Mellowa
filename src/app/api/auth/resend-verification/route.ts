import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parsePlanIntent, sanitizeNextPath, serializeIntent } from "@/lib/auth/intent";
import { honeypotTripped } from "@/lib/auth/honeypot";
import { AUTH_RATE_LIMITS, emailBucket, enforceAuthRateLimits } from "@/lib/auth/rate-limit";

/**
 * Server-side "resend confirmation email" (request-flood protection).
 *
 * Per-address limit: 3 per hour (429 + Retry-After; limiter unavailable → 503,
 * fail closed), on top of the card's 60-second client cooldown.
 *
 * Non-enumerating: the Supabase result is ignored and every accepted request
 * gets the same `{ ok: true }` regardless of account state. The funnel intent
 * (?plan / ?next) is re-sanitized here and carried on the callback link exactly
 * as before. Uses the SERVER Supabase client so the PKCE code-verifier is set
 * on this response's cookies.
 */

const ResendBody = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
  plan: z.string().max(16).nullable().optional(),
  next: z.string().max(512).nullable().optional(),
});

function genericOk() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (honeypotTripped(body)) return genericOk();

  const parsed = ResendBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { email } = parsed.data;
  const plan = parsePlanIntent(parsed.data.plan);
  const next = sanitizeNextPath(parsed.data.next);

  const limited = await enforceAuthRateLimits([
    { bucket: emailBucket(AUTH_RATE_LIMITS.resendEmail, email), rule: AUTH_RATE_LIMITS.resendEmail },
  ]);
  if (limited) return limited;

  const origin = new URL(request.url).origin;
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback${serializeIntent({ plan, next })}`,
    },
  });
  if (error) {
    console.error("[auth/resend-verification] resend failed", { status: error.status, code: error.code });
  }
  return genericOk();
}
