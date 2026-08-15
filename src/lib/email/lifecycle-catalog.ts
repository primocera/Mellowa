import {
  EMAIL_CATEGORIES,
  type EmailTemplateName,
} from "@/lib/email/categories";

/**
 * MW-V18-17: the lifecycle message catalog.
 *
 * Every message that can reach a user is declared here with its PURPOSE, the
 * durable SERVER FACT that triggers it, its CONSENT class, a DEDUPE key and a
 * SUPPRESSION rule. Messages are sent from durable facts (auth, subscriptions,
 * delivery ledger) — never because a page view was missing or a client clock
 * changed. Consent class is DERIVED from the existing category registry so this
 * catalog can never disagree with it.
 *
 * Copy stays neutral and non-medical; no mood/journal/meal/check-in content ever
 * appears in a subject, body or provider metadata (enforced by the existing
 * lifecycle-emails test).
 */

export type ConsentClass = "transactional" | "optional";

export interface MessageSpec {
  purpose: string;
  /** The durable server fact that fires it. */
  trigger: string;
  consentClass: ConsentClass;
  /** How repeats are collapsed — the outbox dedupe key shape. */
  dedupeKey: string;
  /** When it must NOT send. */
  suppression: string;
}

type Classification = Omit<MessageSpec, "consentClass">;

const CLASS: Record<EmailTemplateName, Classification> = {
  verify: {
    purpose: "Confirm the email address so the account is usable.",
    trigger: "signup without a confirmed email",
    dedupeKey: "verify:<userId>",
    suppression: "email already confirmed",
  },
  welcome: {
    purpose: "Orient a new user to the first useful action.",
    trigger: "first successful sign-in",
    dedupeKey: "welcome:<userId>",
    suppression: "already sent once",
  },
  sample_ready: {
    purpose: "Tell the user their one free sample plan is ready.",
    trigger: "sample plan generated (server)",
    dedupeKey: "sample_ready:<userId>",
    suppression: "already sent once per user",
  },
  trial_started: {
    purpose: "Confirm the trial and the exact charge date/amount.",
    trigger: "subscription trial created (webhook)",
    dedupeKey: "trial_started:<subscriptionId>",
    suppression: "no trial on the subscription",
  },
  trial_ending: {
    purpose: "Remind of the exact charge date before it happens.",
    trigger: "trial end within the reminder window (subscription fact)",
    dedupeKey: "trial_ending:<subscriptionId>",
    suppression: "already canceled, or already charged",
  },
  trial_ended: {
    purpose: "Confirm the trial converted or ended.",
    trigger: "trial-to-active or trial-end transition (webhook)",
    dedupeKey: "trial_ended:<subscriptionId>",
    suppression: "transition not observed",
  },
  canceled: {
    purpose: "Confirm cancellation and access-until date.",
    trigger: "cancel-at-period-end set (webhook)",
    dedupeKey: "canceled:<subscriptionId>:<periodEnd>",
    suppression: "not canceled",
  },
  payment_failed: {
    purpose: "Tell the user a payment failed and how recovery works.",
    trigger: "invoice payment failed (webhook)",
    dedupeKey: "payment_failed:<invoiceId>",
    suppression: "invoice already paid/recovered",
  },
  payment_recovered: {
    purpose: "Confirm a previously failed payment recovered.",
    trigger: "invoice recovered (webhook)",
    dedupeKey: "payment_recovered:<invoiceId>",
    suppression: "no prior failure",
  },
  account_deleted: {
    purpose: "Confirm the account and data were deleted.",
    trigger: "deletion job verified complete (server state machine)",
    dedupeKey: "account_deleted:<requestId>",
    suppression: "deletion not verified",
  },
  daily_reminder: {
    purpose: "A gentle nudge to open today's plan.",
    trigger: "opted-in reminder time reached, quiet hours respected",
    dedupeKey: "daily_reminder:<userId>:<localDate>",
    suppression: "reminders_opt_in false, quiet hours, or already sent today",
  },
  onboarding_nudge: {
    purpose: "One-time nudge to finish onboarding.",
    trigger: "no wellbeing profile after signup",
    dedupeKey: "onboarding_nudge:<userId>",
    suppression: "profile exists (once-ever key)",
  },
};

export const LIFECYCLE_MESSAGES: Record<EmailTemplateName, MessageSpec> =
  Object.fromEntries(
    (Object.keys(CLASS) as EmailTemplateName[]).map((t) => [
      t,
      { ...CLASS[t], consentClass: EMAIL_CATEGORIES[t] as ConsentClass },
    ])
  ) as Record<EmailTemplateName, MessageSpec>;

/** True when `template` is a registered lifecycle message (the delivery gate). */
export function isDeliverableTemplate(template: string): template is EmailTemplateName {
  return Object.prototype.hasOwnProperty.call(LIFECYCLE_MESSAGES, template);
}

/** The registered spec for a template, or null when it is not in the catalog. */
export function messageSpecFor(template: string): MessageSpec | null {
  return isDeliverableTemplate(template) ? LIFECYCLE_MESSAGES[template] : null;
}

// --- deep links --------------------------------------------------------------

/** Internal destinations a message may deep-link to. */
export const DEEP_LINK_ALLOWLIST = [
  "/today",
  "/you",
  "/weekly-plan",
  "/plan",
  "/progress",
  "/pricing",
  "/settings",
  "/verify-email",
] as const;

/**
 * Validate a deep-link path. Must be a relative internal path on the allowlist
 * (no absolute URLs, no auth tokens in the query). A caller that gets null must
 * fall back to a safe default (e.g. /today) so a message never links nowhere.
 */
export function allowlistedDeepLink(path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  const [pathname] = path.split("?");
  return (DEEP_LINK_ALLOWLIST as readonly string[]).includes(pathname) ? path : null;
}
