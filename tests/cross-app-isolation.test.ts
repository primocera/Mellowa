import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldApplyStripeEvent } from "@/lib/stripe/event-order";

/**
 * XAPP-V12-01 (Mellowa side): a foreign product's signal must produce no
 * Mellowa side effect.
 *
 * Mellowa, Scalvya and Frost share operational providers — one Stripe account,
 * one Resend account, one auth pattern. A Stripe webhook endpoint subscribes to
 * event TYPES, not products, so every enabled endpoint receives every matching
 * event on the account. The filtering has to happen in the handler. This file
 * is the Scalvya→Mellowa half of the symmetric regression the prompt asks for:
 * a foreign event, acknowledged without mutation, email, entitlement or
 * analytics. The Scalvya→ side and the live cross-app pairing live in
 * primocera/LaunchBloom and are owner-run.
 *
 * Test/doc-only by design: XAPP-V12-01 is read-only-first, so nothing here
 * changes product code (which would invalidate candidate 745b4a4).
 */

const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
const send = readFileSync("src/lib/email/send.ts", "utf8");
const unsubscribe = readFileSync("src/lib/email/unsubscribe.ts", "utf8");
const callback = readFileSync("src/app/auth/callback/route.ts", "utf8");

describe("Stripe: a foreign-product event causes no Mellowa side effect", () => {
  it("ignores a subscription with no supabase_user_id and no known customer", () => {
    // A Mellowa subscription always carries supabase_user_id from checkout, so
    // its absence + no matching stored customer means the event is not ours.
    expect(webhook).toContain("ignoring subscription from another product");
    expect(webhook).toMatch(/return \{ ignored: true as const \}/);
    // Every syncSubscription call site is guarded, so no downstream analytics
    // or email runs for a foreign customer.
    const guards = webhook.match(/\?\.ignored\) break;/g) ?? [];
    const calls = webhook.match(/syncSubscription\(subscription\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(guards.length).toBe(calls.length);
  });

  it("drops a foreign invoice event before any mutation, email or analytics", () => {
    // The invoice branches read the subscriptions row first; a foreign customer
    // has no row, so nothing downstream runs (MW-V12-03).
    for (const label of ["invoice.payment_failed", "invoice.payment_succeeded"]) {
      const start = webhook.indexOf(`case "${label}"`);
      const rest = webhook.slice(start + label.length);
      const block = rest.slice(0, rest.search(/\n {6}(case "|default:)/));
      expect(block, `${label} does not read the row before acting`).toMatch(
        /from\("subscriptions"\)[\s\S]*maybeSingle\(\)/,
      );
    }
    // Foreign refunds and disputes resolve to a user first, or are dropped.
    expect(webhook).toContain("refundUserId");
    expect(webhook).toContain("disputeUserId");
  });

  it("cannot collide idempotency across products — event ids are account-global", () => {
    // claim_stripe_event keys on the Stripe event id, which is unique across the
    // whole account, so a Scalvya event can never be mistaken for a processed
    // Mellowa one.
    expect(webhook).toContain("claim_stripe_event");
    expect(webhook).toMatch(/p_event_id: event\.id/);
  });

  it("a stale/foreign-ordered event is still handled by created-order", () => {
    // Ordering is product-agnostic and pure; a redelivered older event never
    // overwrites a newer state, whichever product it came from.
    expect(shouldApplyStripeEvent(100, 200)).toBe(false);
    expect(shouldApplyStripeEvent(200, 100)).toBe(true);
  });
});

describe("Email: identity and opt-out are per-app, never another brand's", () => {
  it("sends from the app's configured EMAIL_FROM, not a hardcoded brand", () => {
    expect(send).toContain("serverEnv.emailFrom");
    expect(send).not.toMatch(/from:\s*["'][^"']*@(scalvya|frost)/i);
  });

  it("the unsubscribe link is signed with this app's own secret", () => {
    // HMAC with EMAIL_UNSUBSCRIBE_SECRET (falling back to CRON_SECRET) — a token
    // minted by another app cannot verify here, so suppression cannot cross
    // brands.
    expect(unsubscribe).toContain("EMAIL_UNSUBSCRIBE_SECRET");
    expect(unsubscribe).toContain("createHmac");
  });
});

describe("Auth: redirects cannot target another app or production", () => {
  it("only follows allow-listed relative paths", () => {
    expect(callback).toContain("sanitizeNextPath");
    // Redirects are resolved against this request's own origin, not an
    // attacker- or cross-app-supplied absolute URL.
    expect(callback).toMatch(/new URL\(path, url\.origin\)/);
  });
});
