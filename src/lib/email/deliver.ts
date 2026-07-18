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
    /** Stored so the outbox worker can replay without the original caller. */
    to?: string;
    subject?: string;
    html?: string;
  }): Promise<LedgerRow | null>;
  finalize(args: {
    id: string;
    status: "sent" | "not_configured" | "failed_transient" | "failed_permanent";
    attempts: number;
    providerId?: string | null;
    sentAt?: string | null;
    lastError?: string | null;
    /** When the outbox worker should try again (retryable states only). */
    nextAttemptAt?: string | null;
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
    async claim({ eventKey, userId, template, to, subject, html }) {
      // Insert-or-read: the unique event_key makes this race-safe across
      // concurrent cron/webhook retries.
      const { data: inserted } = await admin
        .from("email_deliveries")
        .insert({
          event_key: eventKey,
          user_id: userId,
          template,
          to_email: to ?? null,
          subject: subject ?? null,
          html: html ?? null,
        })
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
    async finalize({ id, status, attempts, providerId, sentAt, lastError, nextAttemptAt }) {
      await admin
        .from("email_deliveries")
        .update({
          status,
          attempts,
          provider_id: providerId ?? null,
          sent_at: sentAt ?? null,
          last_error: lastError ?? null,
          next_attempt_at: nextAttemptAt ?? null,
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
    to: args.to,
    subject: args.subject,
    html: args.html,
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
      nextAttemptAt: nextAttemptIso(row.attempts),
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
    nextAttemptAt: permanent ? null : nextAttemptIso(attempts),
  });
  return { sent: false, status };
}

/**
 * Exponential backoff with jitter for the outbox worker (v6 Prompt 4):
 * ~5, 10, 20, 40, 80 minutes (±20%), capped at 2 hours.
 */
export function backoffDelayMinutes(
  attempts: number,
  random: () => number = Math.random
): number {
  const base = Math.min(5 * 2 ** Math.max(0, attempts - 1), 120);
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.max(1, Math.round(base * jitter));
}

function nextAttemptIso(attempts: number): string {
  return new Date(
    Date.now() + backoffDelayMinutes(attempts) * 60_000
  ).toISOString();
}

/** Row shape the outbox worker replays (see claim_due_emails RPC). */
export interface OutboxRow {
  id: string;
  event_key: string;
  template: string;
  status: string;
  attempts: number;
  to_email: string | null;
  subject: string | null;
  html: string | null;
}

export interface ReplaySummary {
  claimed: number;
  sent: number;
  transient: number;
  permanent: number;
  notConfigured: number;
  skippedNoPayload: number;
}

/**
 * Replays due retryable deliveries from the outbox. Runs from a protected
 * scheduled route; overlap-safe because claim_due_emails uses SKIP LOCKED
 * and leases each row. Independent of the request that created the row.
 */
export async function replayDeliveries(
  limit = 20,
  deps?: {
    claimDue(limit: number): Promise<OutboxRow[]>;
    finalize: DeliverDeps["finalize"];
    send: DeliverDeps["send"];
  }
): Promise<ReplaySummary> {
  const d = deps ?? {
    async claimDue(l: number) {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("claim_due_emails", {
        p_limit: l,
      });
      if (error) {
        console.error("[email-outbox] claim failed", { message: error.message });
        return [];
      }
      return (data ?? []) as OutboxRow[];
    },
    finalize: defaultDeps().finalize,
    send: defaultDeps().send,
  };

  const rows = await d.claimDue(limit);
  const summary: ReplaySummary = {
    claimed: rows.length,
    sent: 0,
    transient: 0,
    permanent: 0,
    notConfigured: 0,
    skippedNoPayload: 0,
  };

  for (const row of rows) {
    if (!row.to_email || !row.subject || !row.html) {
      // Legacy rows created before payload storage cannot be replayed.
      summary.skippedNoPayload += 1;
      await d.finalize({
        id: row.id,
        status: "failed_permanent",
        attempts: row.attempts,
        lastError: "no stored payload to replay",
      });
      continue;
    }

    const attempts = row.attempts + 1;
    const result = await d.send({
      to: row.to_email,
      subject: row.subject,
      html: row.html,
      text: htmlToText(row.html),
    });

    if (result.sent) {
      summary.sent += 1;
      await d.finalize({
        id: row.id,
        status: "sent",
        attempts,
        providerId: result.providerId ?? null,
        sentAt: new Date().toISOString(),
      });
    } else if (result.skipped) {
      summary.notConfigured += 1;
      await d.finalize({
        id: row.id,
        status: "not_configured",
        attempts: row.attempts,
        lastError: "email provider not configured",
        nextAttemptAt: nextAttemptIso(row.attempts),
      });
    } else {
      const permanent = result.permanent === true || attempts >= MAX_ATTEMPTS;
      if (permanent) summary.permanent += 1;
      else summary.transient += 1;
      await d.finalize({
        id: row.id,
        status: permanent ? "failed_permanent" : "failed_transient",
        attempts,
        lastError: result.error ?? "send failed",
        nextAttemptAt: permanent ? null : nextAttemptIso(attempts),
      });
    }
  }

  return summary;
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
