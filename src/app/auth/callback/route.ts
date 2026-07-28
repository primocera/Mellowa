import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { recordRequiredConsents } from "@/lib/consent/status";
import { deliverEmail } from "@/lib/email/deliver";
import { welcomeEmail } from "@/lib/email/templates";
import {
  parsePlanIntent,
  resolveDestination,
  sanitizeNextPath,
} from "@/lib/auth/intent";

/** Email link types we accept on this callback. */
const OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "email",
  "email_change",
  "magiclink",
  "recovery",
  "invite",
]);

function parseOtpType(raw: string | null): EmailOtpType | null {
  return raw && OTP_TYPES.has(raw as EmailOtpType) ? (raw as EmailOtpType) : null;
}

/**
 * Email-verification callback (Launch audit v6, Prompt 1).
 *
 * Accepts both Supabase email-link shapes, because they fail in different
 * places:
 *   - `token_hash` + `type` → `verifyOtp`. Device-independent, so opening the
 *     link on a different device than the one used to sign up still works.
 *   - `code` → `exchangeCodeForSession`. PKCE; requires the code-verifier
 *     cookie set by the browser that started the flow, so a cross-device open
 *     cannot succeed and must fall back to resend rather than look "expired".
 *
 * REQUIRED SUPABASE CONFIG — the "Confirm signup" email template must link to
 * the `token_hash` form, not the default `{{ .ConfirmationURL }}`:
 *
 *   {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup
 *
 * The default sends the user through Supabase's own /auth/v1/verify, which
 * sets `email_confirmed_at` BEFORE redirecting here with `?code=`. If the PKCE
 * exchange then fails — a different browser, a phone, cleared cookies — this
 * route returns at the `link_expired` branch below, which is above the welcome
 * email and the consent write. The result is an account that is confirmed in
 * `auth.users` but has a null `last_sign_in_at`, no welcome mail and no
 * consent row, while the page claims the link expired. Users 266ba450 and
 * 5b261b9a both landed in exactly that state before the template was changed
 * on 2026-07-28.
 *
 * This is dashboard configuration with no representation in the repository, so
 * resetting that template silently reintroduces the bug and it presents as an
 * email-provider fault. `verifyOtp` needs no browser cookie, so the token_hash
 * form also makes cross-device confirmation work.
 *
 * Then performs the trusted post-verification steps server-side: records the
 * consents captured at signup and sends the welcome email (idempotent via its
 * event key). Redirects only to allow-listed relative paths.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = parseOtpType(url.searchParams.get("type"));
  const plan = parsePlanIntent(url.searchParams.get("plan"));
  const next = sanitizeNextPath(url.searchParams.get("next"));

  const redirect = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (!tokenHash && !code) {
    return redirect("/login?error=verify_link_invalid");
  }

  const supabase = await createClient();

  // Prefer the device-independent path when the link carries a token hash.
  const { data, error } =
    tokenHash && otpType
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType })
      : await supabase.auth.exchangeCodeForSession(code as string);

  if (error || !data.user) {
    // Expired, already-used, malformed, or a PKCE link opened on another
    // device. The verify page offers resend.
    return redirect("/verify-email?error=link_expired");
  }

  // A recovery link authenticates the user for a password change only; send
  // them to the reset form instead of into the app.
  if (otpType === "recovery") {
    return redirect("/reset-password");
  }

  const user = data.user;
  const meta = user.user_metadata as Record<string, unknown> | null;
  if (meta?.age_18_plus === true && meta?.terms_and_privacy === true) {
    // Best-effort: the in-app consent checkpoint remains the backstop if this
    // write fails; verification must still complete.
    try {
      await recordRequiredConsents(user.id);
    } catch {
      // ignore — consent checkpoint will collect it before any generation
    }
  }

  if (user.email) {
    const { subject, html } = welcomeEmail();
    try {
      await deliverEmail({
        eventKey: `welcome:${user.id}`,
        userId: user.id,
        template: "welcome",
        to: user.email,
        subject,
        html,
      });
    } catch {
      // ignore — email delivery must never block verification
    }
  }

  return redirect(resolveDestination({ plan, next }));
}
