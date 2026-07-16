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
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[email] Resend send failed", { status: res.status, text });
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      return { sent: false, permanent, error: `provider ${res.status}` };
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
