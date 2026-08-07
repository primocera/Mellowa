# Cross-app Stripe ownership matrix — Mellowa side (XAPP-95-01)

One Stripe account serves Mellowa **and** Scalvya/LaunchBloom **and** Frost. A
webhook endpoint subscribes to event *types*, not products, so every object and
event on the account reaches Mellowa's ingress. Ownership is proven by **exact
metadata**, never object presence, email equality, or a local DB row alone:

- **Mellowa owns:** `metadata.app` = `mellowa` AND `metadata.supabase_user_id === <userId>`
- **Scalvya owns:** `metadata.source === "launchbloom"` + its own app_user_id (audited in `primocera/LaunchBloom`, not here)

The `"mellowa"` spelling in this document is asserted equal to the code constant
`MELLOWA_APP` (`src/lib/stripe/customer.ts`) by `tests/xapp-ownership-matrix.test.ts`
— it is not hand-maintained separately.

## Object × path × rule (Mellowa)

| Stripe object / path | Ownership rule (exact) | Foreign / unresolved outcome |
|---|---|---|
| Customer — search/recover | `findMellowaCustomer` searches `metadata['supabase_user_id']` AND `metadata['app']`; ≥2 live → `multiple` (fail closed) | no create, no charge; email never in query |
| Customer — **stored DB link** | `verifyMellowaCustomerOwnership(storedId)` before reuse (MW-95-01) | mismatch → 503 reconcile; missing → recover; unavailable → 503 retry |
| Customer — recovered/created | same predicate re-applied at the boundary (MW-95-01) | non-owned → fail closed, no Checkout |
| Customer — **concurrent race winner** | `verifyMellowaCustomerOwnership(winnerId)` before adopting a row another request wrote (MW-95-01) | foreign/wrong-user winner → 503 reconcile; never adopted |
| Checkout Session / Portal | opened only on an `owned` customer id | non-owned → 503, no session |
| Subscription (webhook) | `supabase_user_id` on the sub, else a resolvable stored customer row | else "ignoring subscription from another product", `{ ignored: true }` — every `syncSubscription` call site guarded |
| Invoice (webhook) | reads the subscriptions row first | foreign customer has no row → no mutation/email/analytics |
| Charge / Refund (webhook) | resolves `refundUserId` to a local owner first | unresolved → dropped, no side effect |
| Dispute (webhook) | resolves `disputeUserId` to a local owner first | unresolved → dropped, no side effect |
| Price / Product | catalog allowlist; unknown price throws `unknown Stripe price` | foreign price never stored as a plan |
| Event idempotency | `claim_stripe_event(p_event_id: event.id)` — account-global id | a foreign event id can never be mistaken for a processed Mellowa one |

## Guarantees under adversarial input (all synthetic, opaque IDs)

- Same **email** across products → not proof; never matched on.
- Same-looking **UUID** as `supabase_user_id` but `app !== "mellowa"` → foreign → zero side effects.
- Correct `app`, **wrong** `supabase_user_id` → `mismatch` → fail closed.
- **Missing** metadata → `mismatch`, never owned.
- **Durable foreign customer link** in our own row → re-verified, not trusted → reconcile.
- **Foreign race winner** row → re-verified before adoption → reconcile.
- **Deleted / resource_missing** id → `missing` → orphan recovery, never charged.
- **Transient** retrieve/search failure → `unavailable` → fail closed, observable.
- Duplicate / out-of-order events → idempotent by account-global event id + created-order.

Public copy stays generic billing-unavailable/retry/support language and never
names the other product or an internal ownership field. Live-money transitions
and production price verification remain owner-run and are not passed by mocks.
