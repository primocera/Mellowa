/**
 * Content inventory with stable message IDs (Content Elevation v6, Prompt 19).
 *
 * This is the localization-readiness catalog: every customer-facing string we
 * want to translate later gets a stable, namespaced ID here so future locales
 * key off the ID, not the English text. Today the app still renders English
 * directly in components; this catalog is the migration target and the audit
 * surface for CTA clarity, placeholder-safety and translation policy.
 *
 * Rules encoded here:
 * - IDs are stable and namespaced (`area.key`); never renumber or reuse.
 * - CTAs carry an explicit verb so they read clearly out of context (screen
 *   readers announce button names alone).
 * - Locale-aware formatting (dates, prices, decimals, plurals) is done with
 *   `Intl` at render time — see src/lib/email/billing-facts.ts. Never bake a
 *   currency symbol or date format into a translated string.
 * - Safety, crisis, medical-boundary and legal copy is LOCKED: it must be
 *   human-translated and reviewed per locale, never machine-translated or
 *   shipped partially. See LOCALIZATION_LOCKED.
 */

export interface Message {
  id: string;
  /** Current English source text. */
  en: string;
  /** CTA/button names must name the action explicitly. */
  cta?: boolean;
  /**
   * Locked strings are never machine-translated or shipped partially
   * translated (safety, crisis, medical boundary, legal).
   */
  locked?: boolean;
}

export const MESSAGES = {
  // Primary actions — explicit verbs, safe to read out of context.
  "checkin.cta.shape": { id: "checkin.cta.shape", en: "Shape today's plan", cta: true },
  "checkin.cta.lightest": {
    id: "checkin.cta.lightest",
    en: "Give me the lightest version",
    cta: true,
  },
  "today.cta.lighter": { id: "today.cta.lighter", en: "Make today lighter", cta: true },
  "week.cta.shape": { id: "week.cta.shape", en: "Shape this week", cta: true },
  "meals.cta.create": { id: "meals.cta.create", en: "Create meal ideas", cta: true },
  "onboarding.cta.first": {
    id: "onboarding.cta.first",
    en: "Create my first check-in",
    cta: true,
  },
  "billing.cta.updatePayment": {
    id: "billing.cta.updatePayment",
    en: "Update payment method",
    cta: true,
  },
  "billing.cta.confirmCancel": {
    id: "billing.cta.confirmCancel",
    en: "Confirm cancellation",
    cta: true,
  },
  "data.cta.download": { id: "data.cta.download", en: "Download my data (JSON)", cta: true },
  "data.cta.delete": { id: "data.cta.delete", en: "Delete my account", cta: true },
  "help.cta.email": { id: "help.cta.email", en: "Email support", cta: true },

  // Locked: safety and legal boundaries — human translation only.
  "safety.crisis.opening": {
    id: "safety.crisis.opening",
    en: "I'm sorry this feels urgent. Mellowa can't provide crisis support.",
    locked: true,
  },
  "safety.classifier.unavailable": {
    id: "safety.classifier.unavailable",
    en: "Mellowa can't safely review this request right now, so it won't create a plan.",
    locked: true,
  },
  "boundary.notMedical": {
    id: "boundary.notMedical",
    en: "Mellowa is not medical care, therapy or emergency support.",
    locked: true,
  },
} satisfies Record<string, Message>;

export type MessageId = keyof typeof MESSAGES;

function entry(id: MessageId): Message {
  return MESSAGES[id];
}

export function isCta(id: MessageId): boolean {
  return entry(id).cta === true;
}

export function isLocked(id: MessageId): boolean {
  return entry(id).locked === true;
}

/** IDs that must be human-translated and reviewed per locale. */
export const LOCALIZATION_LOCKED: MessageId[] = (
  Object.keys(MESSAGES) as MessageId[]
).filter(isLocked);

/** Resolve a message to its current source text (English until locales land). */
export function message(id: MessageId): string {
  return entry(id).en;
}
