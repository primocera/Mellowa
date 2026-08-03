# MW-P1-07 — Shared Stripe isolation decision record (v13)

Mellowa, Scalvya and Frost share **one Stripe account, one Resend account, one
auth pattern**. A Stripe webhook endpoint subscribes to event **types**, not
products, so every enabled endpoint receives every matching event on the account.
This record chooses the target isolation architecture and defines the
**non-destructive phase 1** that is safe to implement now.

## Threat / failure model

1. A foreign product's subscription event grants or revokes a Mellowa entitlement.
2. A foreign price/customer/metadata is mistaken for Mellowa's.
3. An operational mistake on the shared account (a wrong webhook secret, a product
   allowlist edit, a portal config change) affects multiple apps at once.
4. One product's event volume disables another product's webhook (retry storms on
   foreign events).

## Current Mellowa strengths (verified present at launch/v13 — keep these)

- **Auth-derived identity:** every Mellowa subscription carries
  `metadata.supabase_user_id` from checkout; entitlement is keyed to it.
- **Server price allowlist by construction:** `src/app/api/stripe/checkout/route.ts`
  only ever uses `serverEnv.stripePriceProMonthly` / `stripePriceProYearly`. The
  client cannot inject a price id.
- **Checkout idempotency including price + interval:**
  `checkout_${user.id}_${interval}_${price}` — a price change mints a new key, and
  a double-submit cannot create a duplicate subscription.
- **Trial pinning from a closed allowlist:** `src/lib/stripe/trial-experiment.ts`
  — an unknown variant never moves an existing user's charge date.
- **Webhook dedupe + created-order guard:** `claim_stripe_event` (idempotency) and
  `src/lib/stripe/event-order.ts` (`shouldApplyStripeEvent`) — a redelivered or
  genuinely-older event cannot drag a paying user backwards.
- **Foreign-product isolation:** `src/app/api/stripe/webhook/route.ts` ignores any
  subscription with no `supabase_user_id` and no matching stored customer
  (`{ ignored: true }`), and every `syncSubscription` call site is guarded. Proven
  by `tests/cross-app-isolation.test.ts` (Scalvya→Mellowa half; the Scalvya side +
  live pairing are owner-run in primocera/LaunchBloom).

## Options compared

| Option | Isolation | Migration risk | Ops/report/tax | Verdict |
| --- | --- | --- | --- | --- |
| A. Separate Stripe account per product | Strongest (no shared event bus) | Highest — new account, re-create products/prices, **cannot** move a live subscription automatically | Clean per-product reporting/tax | **Target** for scale |
| B. One account, per-product webhook endpoint+secret + strict product/metadata namespaces | Strong at the endpoint + handler | Low — additive endpoints/secrets, no subscription move | Shared reporting; needs discipline | **Phase 1 now** |
| C. Transitional hybrid | Medium | Medium | Mixed | Bridge only |

**Decision:** adopt **B now** (it hardens the shared account without touching any
live subscription), and hold **A** as the target once the paid cohort justifies a
second account and a supervised customer/subscription migration. Never recreate,
cancel, or move a live subscription automatically — A's migration is an
owner-approved, per-customer mapping done out of band.

## Required guarantees (all already met or asserted)

- Mellowa cannot grant entitlement from another product's event/price/customer
  metadata → foreign-product ignore + `supabase_user_id` keying + server price
  allowlist. Asserted by `tests/cross-app-isolation.test.ts`.
- Existing live subscriptions have an explicit **no-break** path → nothing in
  phase 1 mutates a subscription; option A migration is documented as owner-run,
  per-customer, non-destructive.
- Product-scoped idempotency/correlation → checkout key includes user+interval+price;
  webhook events are deduped per event id.

## Safe phase-1 scope (implement now — no production mutation)

Implementable without touching prod endpoints/accounts/secrets:

1. **Config validation tests** (present): foreign-product ignore, order guard,
   idempotency-includes-price, trial allowlist. These fail CI if an isolation
   invariant regresses.
2. **Dry-run audit tooling** (owner-run, read-only): use existing
   `npm run verify-prices` (asserts the live price ids read back EUR 999/5999 on a
   EUR-default account) and `node scripts/secret-fingerprint.mjs` (confirms the
   webhook signing secret **identity** without printing a value). These report
   presence/identity/anomalies with **no PII and no mutation**.
3. **Explicit foreign-product ignore + alert**: the handler already logs
   `"[stripe] ignoring subscription from another product"` with a redacted id; wire
   this log line into the monitoring thresholds (MW-P1-10) so a spike in foreign
   events is visible rather than silent.

## Out of scope for this prompt (owner-approved separate operation)

- Creating a per-product webhook endpoint + secret on the live account.
- Any subscription migration or a second Stripe account (option A).
- Secret rotation.

## Residual shared-account risk

Owner: Primoz Cerar. Target: move to **option A** before the paid cohort scales
beyond people the owner can contact directly. Until then, the shared-account risk
is bounded by the handler's `supabase_user_id` keying and the foreign-product
ignore, both under regression test.
