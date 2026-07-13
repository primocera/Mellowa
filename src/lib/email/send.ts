import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * Minimal Resend client over fetch — no extra dependency.
 * If RESEND_API_KEY is not configured, email is skipped silently so the app
 * keeps working in development and before the email provider is wired up.
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean; skipped?: boolean }> {
  const apiKey = serverEnv.resendApiKey;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping", {
      subject: args.subject,
    });
    return { sent: false, skipped: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: serverEnv.emailFrom,
        to: args.to,
        subject: args.subject,
        html: args.html,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[email] Resend send failed", { status: res.status, text });
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error("[email] Resend request threw", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return { sent: false };
  }
}
