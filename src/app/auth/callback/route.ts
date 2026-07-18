import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordRequiredConsents } from "@/lib/consent/status";
import { deliverEmail } from "@/lib/email/deliver";
import { welcomeEmail } from "@/lib/email/templates";
import {
  parsePlanIntent,
  resolveDestination,
  sanitizeNextPath,
} from "@/lib/auth/intent";

/**
 * Email-verification callback (Launch audit v6, Prompt 1).
 *
 * Exchanges the Supabase verification code for a session, then performs the
 * trusted post-verification steps server-side: records the consents captured
 * at signup and sends the welcome email (idempotent via its event key).
 * Redirects only to allow-listed relative paths.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const plan = parsePlanIntent(url.searchParams.get("plan"));
  const next = sanitizeNextPath(url.searchParams.get("next"));

  const redirect = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (!code) {
    return redirect("/login?error=verify_link_invalid");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    // Expired, already-used or malformed link. The verify page offers resend.
    return redirect("/verify-email?error=link_expired");
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
