import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { honeypotTripped } from "@/lib/auth/honeypot";
import { AUTH_RATE_LIMITS, emailBucket, enforceAuthRateLimits } from "@/lib/auth/rate-limit";

/**
 * Server-side password-reset request (request-flood protection).
 *
 * Per-address limit: 3 per hour (429 + Retry-After; limiter unavailable → 503,
 * fail closed). The limit applies whether or not the address has an account,
 * so a 429 reveals nothing about account existence.
 *
 * Non-enumerating: the Supabase result is deliberately ignored and every
 * accepted request gets the same generic `{ ok: true }`, whether or not an
 * account exists. A filled honeypot gets that same response and sends nothing.
 *
 * Uses the SERVER Supabase client, whose cookie adapter writes the PKCE
 * code-verifier onto this response, so the reset link opened in this browser
 * still completes exactly as when the browser requested it directly.
 */

const ResetBody = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
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

  const parsed = ResetBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { email } = parsed.data;

  const limited = await enforceAuthRateLimits([
    { bucket: emailBucket(AUTH_RATE_LIMITS.resetEmail, email), rule: AUTH_RATE_LIMITS.resetEmail },
  ]);
  if (limited) return limited;

  const origin = new URL(request.url).origin;
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });
  if (error) {
    // Logged without the address; the response stays generic either way.
    console.error("[auth/password-reset] request failed", { status: error.status, code: error.code });
  }
  return genericOk();
}
