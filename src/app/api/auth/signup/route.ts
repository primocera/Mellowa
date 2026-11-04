import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isBetaGateError } from "@/lib/beta/capacity-shared";
import { parsePlanIntent, sanitizeNextPath, serializeIntent } from "@/lib/auth/intent";
import { honeypotTripped } from "@/lib/auth/honeypot";
import {
  AUTH_RATE_LIMITS,
  clientIp,
  emailBucket,
  enforceAuthRateLimits,
  ipBucket,
} from "@/lib/auth/rate-limit";

/**
 * Server-side signup (request-flood protection).
 *
 * The browser used to call supabase.auth.signUp directly, so nothing bounded
 * how often one client or one address could create accounts or trigger
 * confirmation mail. This route:
 *  - answers a filled honeypot with the same generic success and creates
 *    nothing (no Supabase call, no limiter hit);
 *  - validates the body, including the three explicit consents (18+, Terms &
 *    Privacy, GDPR Art. 9 health data), which travel in user metadata exactly
 *    as before so the auth callback records them after verification;
 *  - enforces per-IP (5/hour) and per-address (3/day) limits through the
 *    durable limiter (429 + Retry-After; limiter unavailable → 503, fail closed);
 *  - signs up with the SERVER Supabase client. With @supabase/ssr the PKCE
 *    code-verifier (and, when confirmation is off, the session) is written via
 *    the cookie adapter onto this response, so the email link / callback keep
 *    working exactly as when the browser called signUp itself.
 *
 * Non-enumerating: an already-registered address gets the same
 * "check your email" response as a new one.
 */

const SignupBody = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
  password: z.string().min(8).max(256),
  age18: z.literal(true),
  policies: z.literal(true),
  healthData: z.literal(true),
  plan: z.string().max(16).nullable().optional(),
  next: z.string().max(512).nullable().optional(),
});

/** The generic success every non-session outcome returns. */
function verifyEmailResponse() {
  return NextResponse.json({ ok: true, next: "verify_email" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Bots that fill every field get the ordinary success and nothing happens.
  if (honeypotTripped(body)) return verifyEmailResponse();

  const parsed = SignupBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { email, password } = parsed.data;
  const plan = parsePlanIntent(parsed.data.plan);
  const next = sanitizeNextPath(parsed.data.next);

  const limited = await enforceAuthRateLimits([
    {
      bucket: ipBucket(AUTH_RATE_LIMITS.signupIp, clientIp(request.headers) ?? "unknown"),
      rule: AUTH_RATE_LIMITS.signupIp,
    },
    { bucket: emailBucket(AUTH_RATE_LIMITS.signupEmail, email), rule: AUTH_RATE_LIMITS.signupEmail },
  ]);
  if (limited) return limited;

  const origin = new URL(request.url).origin;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback${serializeIntent({ plan, next })}`,
      // Consents travel in user metadata; the auth callback records them
      // server-side after the email is verified (unchanged contract).
      data: { age_18_plus: true, terms_and_privacy: true, health_data: true },
    },
  });

  if (error) {
    const message = error.message ?? "";
    // MW-V10-06: the beta gate (a DB trigger) surfaces as a wrapped error.
    if (isBetaGateError(message)) {
      return NextResponse.json({ error: "beta_closed" }, { status: 403 });
    }
    // Non-enumerating: an existing address looks exactly like a new one.
    if (/already registered/i.test(message)) return verifyEmailResponse();
    if (/rate limit|too many/i.test(message)) {
      return NextResponse.json(
        { error: "rate_limited", user_message: "Too many attempts just now. Wait a minute and try again." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
    if (/password/i.test(message) && /short|weak|at least/i.test(message)) {
      return NextResponse.json({ error: "weak_password" }, { status: 400 });
    }
    // Raw provider strings never reach the browser.
    console.error("[auth/signup] signUp failed", { status: error.status, code: error.code });
    return NextResponse.json({ error: "signup_failed" }, { status: 400 });
  }

  if (data.session) {
    // Email confirmation disabled (e.g. local dev): the session cookies were set
    // on this response; the browser records consents and continues.
    return NextResponse.json({ ok: true, next: "session" }, { headers: { "Cache-Control": "no-store" } });
  }
  return verifyEmailResponse();
}
