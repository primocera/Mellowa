import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * One Stripe account, several products, one shared event stream.
 *
 * This account also serves Scalvya and Frost. A Stripe webhook endpoint
 * subscribes to *event types*, not to products or customers, so every enabled
 * endpoint receives every matching event on the account. Separate URLs separate
 * nothing — the filtering has to happen in the handler.
 *
 * The owner saw the consequence directly: Scalvya emailed him that a trial was
 * ending, for a Mellowa trial, on an account he does not have with Scalvya.
 *
 * Our side had the mirror problem, and a worse one. An unmappable subscription
 * raised a RetryableError, so every Scalvya and Frost subscription event became
 * a permanently failing delivery on Mellowa's endpoint — and Stripe disables
 * endpoints that keep failing. A disabled Mellowa webhook means paying users
 * silently never get access, which is exactly the "paid but no access" failure
 * v10 spent a slice fixing, arriving through a different door.
 */

const route = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

describe("events from other products on the shared account are ignored", () => {
  it("acks a subscription that carries no supabase_user_id and no known customer", () => {
    expect(route).toContain("ignoring subscription from another product");
    expect(route).toMatch(/return \{ ignored: true as const \}/);
  });

  it("still retries when the subscription IS ours but the row is not written yet", () => {
    // The race this originally guarded must survive: a Mellowa subscription
    // always carries the metadata from the moment checkout creates it, so
    // metadata present + no row means "too early", not "not ours".
    expect(route).toContain("RetryableError(`unmapped subscription");
    expect(route).toMatch(/if \(!userId\) \{/);
  });

  it("stops every handler that syncs a subscription, not just the sync itself", () => {
    // Otherwise analytics and lifecycle code downstream would still act on
    // another product's customer.
    // The declaration reads `syncSubscription(subscription: Stripe.Subscription)`,
    // so it does not match this pattern — every match here is a real call site.
    const guards = route.match(/\?\.ignored\) break;/g) ?? [];
    const calls = route.match(/syncSubscription\(subscription\)/g) ?? [];
    expect(calls.length, "no syncSubscription call sites found").toBeGreaterThanOrEqual(4);
    expect(guards.length, "a syncSubscription call site is unguarded").toBe(calls.length);
  });

  it("never emails a customer it cannot map to one of our users", () => {
    // emailForCustomer resolves through our own subscriptions table, so a
    // foreign customer yields null and no mail is sent.
    expect(route).toMatch(/if \(!userId\) return null;/);
    expect(route).toMatch(/const email = await emailForCustomer\(/);
  });
});
