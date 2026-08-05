# XAPP-01 — Shared-Stripe isolation matrix (Mellowa side)

One Stripe account serves **Mellowa**, **Scalvya** and **Frost**. Stripe
broadcasts every event to every enabled endpoint and does not convert currency
or scope customers by product, so isolation is enforced in code, not by Stripe.
This matrix records the Mellowa-side guarantees, their code references and the
tests that pin them. The Scalvya side is audited in its own repository (not this
one) — per the pack rule, the two repos are never opened in one session.

**Ownership rule:** a Mellowa object is proven by metadata — `supabase_user_id`
**and** `app: "mellowa"` — never by a shared email.

| # | Isolation guarantee | Where enforced | Test(s) |
|---|---|---|---|
| 1 | Every customer we mint carries `app: mellowa` + `supabase_user_id` | `src/lib/stripe/checkout/route.ts` (`customers.create` metadata), `src/lib/stripe/customer.ts` (`MELLOWA_APP`) | `checkout-customer-idempotency`, `xapp-isolation` |
| 2 | Checkout Session + Subscription metadata carry `app: mellowa` | `checkout/route.ts` session `metadata` + `subscription_data.metadata` | `xapp-isolation` ("stamps the app namespace everywhere") |
| 3 | Orphan recovery matches on `supabase_user_id` + `app`, never email; multiple candidates fail closed | `customer.ts` `findMellowaCustomer` (search query) | `xapp-isolation`, `checkout-customer-idempotency` |
| 4 | Idempotency keys carry the `mellowa` namespace + stable user id (not email) | `customer.ts` `customerIdempotencyKey`; `checkout/route.ts` `mellowa_checkout_…` | `xapp-isolation`, `billing-contract` |
| 5 | A foreign subscription (no `supabase_user_id`, no known customer) is acked without mutation, email or analytics | `checkout/webhook/route.ts` `syncSubscription` → `{ ignored: true }`; every call site guarded | `webhook-isolation` |
| 6 | Foreign invoice/charge/dispute events touch nothing (no local row = no action) | `webhook/route.ts` invoice/refund/dispute branches read the row first | `webhook-isolation` |
| 7 | Reconciliation never adopts a foreign product's subscription; a foreign price throws instead of guessing a plan | `reconcile.ts` `adoptSubscriptionForCustomer` / `planNameForPrice`; only walks Mellowa-owned rows | `xapp-isolation` ("throws on a foreign price") |
| 8 | Product ownership is verified on every configured price | `scripts/verify-stripe-prices.mjs` (`evaluateProductOwnership`, `metadata?.app`) | `billing-contract` ("verifies the price's product ownership") |
| 9 | Logs expose opaque IDs only — never full email / plan / journal text | `checkout/route.ts` reconciliation log (ids only); webhook logs | `checkout-customer-idempotency` ("logs ids only — never the email") |

## Symmetrical negative cases covered

Same email, same-looking user id, foreign product, foreign price, missing app
metadata, deleted customer, multiple-candidate recovery — each has a Mellowa
test that proves the foreign/ambiguous case is **ignored or fails closed**, never
adopted:

- **Same email / no ownership metadata** → `findMellowaCustomer` filters by
  metadata, not email (`xapp-isolation`).
- **Foreign product / price** → `adoptSubscriptionForCustomer` throws
  (`xapp-isolation`); webhook `syncSubscription` returns `ignored`
  (`webhook-isolation`).
- **Missing app metadata on an event** → foreign-event ack, no mutation
  (`webhook-isolation`).
- **Deleted customer** → excluded from recovery (`checkout-customer-idempotency`).
- **Multiple owned candidates** → `customer_reconciliation_required`, no charge
  (`checkout-customer-idempotency`, `xapp-isolation`).

## Gaps / notes (Mellowa side)

- The isolation depends on Mellowa **always** writing `supabase_user_id` (and now
  `app`) on the customer, session and subscription. All three write paths are in
  `checkout/route.ts`; there is no other object-minting path.
- The durable fix remains a **separate Stripe account per product**. Until then,
  these guards keep one product's traffic from disabling another's webhook or
  crossing entitlement/analytics/email. This is inventoried as an accepted risk,
  not a launch blocker for the isolation itself.
- This audit is code + tests only. No live Stripe was queried and no
  configuration values are exposed here.
