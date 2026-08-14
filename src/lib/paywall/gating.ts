/**
 * MW-V18-16: paywall timing + honesty, without touching billing.
 *
 * Two pure concerns the pack requires and that need no Stripe change:
 *  1. A paywall appears AFTER the user has experienced value, never prematurely,
 *     and never to someone who already has access.
 *  2. Paywall/pricing copy avoids dark patterns (fake urgency, fake scarcity,
 *     guilt, a preselected annual plan, confusing close controls).
 *
 * Entitlement and checkout truth stay in the existing frozen billing modules;
 * this only decides WHETHER and HOW HONESTLY to prompt.
 */

export type Entitlement = "free" | "trialing" | "premium" | "past_due" | "canceled" | "unknown";

export interface PaywallDecision {
  show: boolean;
  reason: string;
}

/**
 * Decide whether to show an upgrade prompt.
 *  - Never to a user who already has access (premium/trialing) — that is nagging.
 *  - Never before the user has experienced value (first durable action) — a
 *    premature paywall sells nothing and erodes trust.
 *  - Fail closed to NOT showing when entitlement is unknown (never pressure a
 *    user we cannot classify).
 */
export function shouldShowPaywall(input: {
  entitlement: Entitlement;
  experiencedValue: boolean;
}): PaywallDecision {
  if (input.entitlement === "premium" || input.entitlement === "trialing") {
    return { show: false, reason: "already has access — no upgrade pressure" };
  }
  if (input.entitlement === "unknown") {
    return { show: false, reason: "entitlement unknown — fail closed, do not pressure" };
  }
  if (!input.experiencedValue) {
    return { show: false, reason: "no experienced value yet — a premature paywall sells nothing" };
  }
  return { show: true, reason: "value experienced and not yet subscribed — an honest prompt is fair" };
}

// --- dark-pattern copy policy ------------------------------------------------

/**
 * Phrases/patterns that must never appear in paywall or pricing copy. Fake
 * urgency, fake scarcity, guilt/health-fear, and manipulative close controls.
 */
const DARK_PATTERNS: { id: string; re: RegExp }[] = [
  { id: "fake_urgency", re: /\b(hurry|act now|last chance|ends (tonight|soon)|don'?t miss out|limited time)\b/i },
  { id: "countdown", re: /\b(only )?\d+\s*(minutes?|hours?|seconds?)\s*(left|remaining)\b/i },
  { id: "fake_scarcity", re: /\bonly \d+ (spots?|seats?|left)\b/i },
  { id: "guilt", re: /\b(you'?ll regret|don'?t you care|serious about your (health|wellbeing) then)\b/i },
  { id: "health_fear", re: /\b(before it'?s too late|your health (can'?t|won'?t) wait)\b/i },
  { id: "confusing_close", re: /\bno,? i (don'?t|hate|prefer not to) (want|care)\b/i },
];

export interface CopyPolicyResult {
  clean: boolean;
  violations: string[];
}

/** Scan copy for dark patterns. Clean copy returns { clean: true, [] }. */
export function checkPaywallCopy(text: string): CopyPolicyResult {
  const violations = DARK_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
  return { clean: violations.length === 0, violations };
}

export const DARK_PATTERN_IDS = DARK_PATTERNS.map((p) => p.id);
