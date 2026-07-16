import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, type SendResult } from "@/lib/email/send";

/**
 * Idempotent transactional-email delivery over the email_deliveries ledger
 * (Prompt 2, audit v5).
 *
 * - `eventKey` uniquely identifies the logical email (e.g.
 *   `trial_ending:<subscription_id>:<trial_end>`), so duplicate cron runs or
 *   webhook retries send exactly one email.
 * - The ledger row is only marked `sent` after provider acceptance. Missing
 *   provider configuration is `not_configured` — never treated as delivered.
 * - Transient failures are retried on later calls with bounded attempts;
 *   after MAX_ATTEMPTS they become `failed_permanent` and stay visible to ops.
 *
 * Callers must gate their own source state (e.g. trial_reminder_sent) on
 * `result.sent === true`.
 */

export const MAX_ATTEMPTS = 5;

export interface DeliverResult {
  sent: boolean;
  status: "sent" | "duplicate" | "not_configured" | "failed_transient" | "failed_permanent";
}

interface LedgerRow {
  id: string;
  status: string;
  attempts: number;
}

export interface DeliverDeps {
  claim(args: {
    eventKey: string;
    userId: string | null;
    template: string;
  }): Promise<LedgerRow | null>;
  finalize(args: {
    id: string;
    status: "sent" | "not_configured" | "failed_transient" | "failed_permanent";
    attempts: number;
    providerId?: string | null;
    sentAt?: string | null;
    lastError?: string | null;
  }): Promise<void>;
  send(args: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    scheduledAt?: string;
  }): Promise<SendResult>;
}

function defaultDeps(): DeliverDeps {
  const admin = createAdminClient();
  return {
    async claim({ eventKey, userId, template }) {
      // Insert-or-read: the unique event_key makes this race-safe across
      // concurrent cron/webhook retries.
      const { data: inserted } = await admin
        .from("email_deliveries")
        .insert({ event_key: eventKey, user_id: userId, template })
        .select("id, status, attempts")
        .maybeSingle();
      if (inserted) return inserted as LedgerRow;
      const { data: existing } = await admin
        .from("email_deliveries")
        .select("id, status, attempts")
        .eq("event_key", eventKey)
        .maybeSingle();
      return (existing as LedgerRow) ?? null;
    },
    async finalize({ id, status, attempts, providerId, sentAt, lastError }) {
      await admin
        .from("email_deliveries")
        .update({
          status,
          attempts,
          provider_id: providerId ?? null,
          sent_at: sentAt ?? null,
          last_error: lastError ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    },
    send: sendEmail,
  };
}

export async function deliverEmail(
  args: {
    eventKey: string;
    userId?: string | null;
    template: string;
    to: string;
    subject: string;
    html: string;
    text?: string;
    /** Hand delivery timing to the provider (Resend scheduled send). */
    scheduledAt?: string;
  },
  deps: DeliverDeps = defaultDeps()
): Promise<DeliverResult> {
  const row = await deps.claim({
    eventKey: args.eventKey,
    userId: args.userId ?? null,
    template: args.template,
  });
  if (!row) {
    return { sent: false, status: "failed_transient" };
  }
  // Already delivered, or permanently failed after bounded retries.
  if (row.status === "sent") return { sent: false, status: "duplicate" };
  if (row.status === "failed_permanent") {
    return { sent: false, status: "failed_permanent" };
  }

  const attempts = row.attempts + 1;
  const result = await deps.send({
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text ?? htmlToText(args.html),
    scheduledAt: args.scheduledAt,
  });

  if (result.sent) {
    await deps.finalize({
      id: row.id,
      status: "sent",
      attempts,
      providerId: result.providerId ?? null,
      sentAt: new Date().toISOString(),
    });
    return { sent: true, status: "sent" };
  }

  if (result.skipped) {
    // Provider not configured: visible to ops, retryable once configured.
    await deps.finalize({
      id: row.id,
      status: "not_configured",
      attempts: row.attempts, // an unconfigured provider is not an attempt
      lastError: "email provider not configured",
    });
    return { sent: false, status: "not_configured" };
  }

  const permanent = result.permanent === true || attempts >= MAX_ATTEMPTS;
  const status = permanent ? "failed_permanent" : "failed_transient";
  await deps.finalize({
    id: row.id,
    status,
    attempts,
    lastError: result.error ?? "send failed",
  });
  return { sent: false, status };
}

/** Minimal HTML → plain-text alternative for email clients without HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
