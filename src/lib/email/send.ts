import "server-only";
import { serverEnv } from "@/lib/env";

export interface SendResult {
  sent: boolean;
  /** Provider not configured — the email was NOT delivered. */
  skipped?: boolean;
  /** Provider message id on acceptance. */
  providerId?: string | null;
  /** 4xx (except 429): retrying the same payload will not succeed. */
  permanent?: boolean;
  error?: string;
}

/**
 * Minimal Resend client over fetch — no extra dependency.
 * If RESEND_API_KEY is not configured the send is skipped and reported as
 * such; callers must never treat a skipped send as delivered (Prompt 2).
 * Logs never include recipient content — only subject and status.
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** ISO instant for Resend scheduled sending (up to ~30 days ahead). */
  scheduledAt?: string;
  /**
   * Absolute opt-out URL for reminder mail. Sends RFC 8058 one-click
   * unsubscribe headers so mail clients can offer a native opt-out button.
   * Omitted for billing/account mail, which is not unsubscribable.
   */
  unsubscribeUrl?: string | null;
}): Promise<SendResult> {
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
        ...(args.text ? { text: args.text } : {}),
        ...(args.scheduledAt ? { scheduled_at: args.scheduledAt } : {}),
        ...(args.unsubscribeUrl
          ? {
              headers: {
                "List-Unsubscribe": `<${args.unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
          : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[email] Resend send failed", { status: res.status, text });
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      /*
       * Keep the provider's explanation, not just the status code.
       *
       * Every send had been failing with `provider 422` for weeks. The reason —
       * a malformed `from` address — was in this response body and was logged
       * here, but only the bare status reached `email_deliveries`. So the admin
       * delivery-health view, the one place anyone would look, showed a wall of
       * identical "provider 422" with nothing to act on.
       *
       * Addresses are redacted before storing: the reason a send failed is
       * operational data, but the recipient is the user's, and this row is read
       * by an admin view and pasted into launch evidence.
       */
      const reason = text
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[address]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      return {
        sent: false,
        permanent,
        error: reason ? `provider ${res.status}: ${reason}` : `provider ${res.status}`,
      };
    }
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, providerId: body?.id ?? null };
  } catch (err) {
    console.error("[email] Resend request threw", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return { sent: false, error: "network error" };
  }
}
