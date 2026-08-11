# Stripe isolation — Mellowa object-provenance matrix (XAPP-V17-01)

Mellowa, Scalvya (LaunchBloom) and Frost share ONE Stripe account. Stripe
broadcasts every event to every enabled endpoint, so isolation is enforced in
code. The **exact Mellowa predicate** is `metadata.app === "mellowa"` AND
`metadata.supabase_user_id === <user>` (`src/lib/stripe/customer.ts`,
`MELLOWA_APP`). Peer discriminator: Scalvya uses `source = "launchbloom"` +
`app_user_id` — a different key, so it never satisfies the Mellowa predicate even
with a same-looking id.

Only **exactly owned** (or a trusted parent: our own stored customer row) may
mutate local state. A same email or same raw UUID carrying a peer discriminator
is **foreign**.

## Provenance per object type

| Object / event | How ownership is proven before any mutation | Foreign/unknown outcome |
|---|---|---|
| **Customer** | `verifyMellowaCustomerOwnership` (retrieve → exact `app`+`supabase_user_id`); `findMellowaCustomer` (search by exact metadata) | `mismatch`/`missing`/`unavailable` → no charge, no portal, reconcile |
| **Checkout session** | created with `metadata` + `subscription_data.metadata` = `{ supabase_user_id, app: mellowa }`; customer verified owned first | foreign customer never opened |
| **Subscription** (`created`/`updated`/`deleted`) | `mellowaUserIdFromMetadata` (exact app) → else trusted stored-customer row | wrong-app/untagged + no stored row → `ignored`, no retry, no side effect |
| **Invoice** (`payment_failed`/`succeeded`) | resolved via `userIdForCustomerId` (our stored customer row) | foreign customer has no row → dropped before mutation/email/analytics |
| **Charge** (`refunded`) | `refundUserId` via stored customer row | foreign → no email/event |
| **Dispute** (`charge.dispute.created`) | `disputeUserId` via the charge's customer → stored row | foreign charge → another product's incident, dropped |
| **Portal** | `verifyMellowaCustomerOwnership` before `billingPortal.sessions.create` | foreign/wrong-user → `customer_reconciliation_required`, no session |
| **PaymentIntent** | not consumed directly for entitlement; entitlement flows only through the subscription/invoice paths above | n/a — never a mutation source |

## Symmetric fixture classes (Mellowa side)

Exercised by `tests/xapp-ownership-matrix.test.ts` (customer predicate) and
`tests/cross-app-isolation.test.ts` (webhook): owned; peer `source`; same
user/wrong app; correct app/wrong user; missing/empty/conflicting metadata;
price-only legacy (resolved via stored parent, never metadata); deleted; provider
unavailable (fail closed, retryable); duplicate (account-global `event.id`
idempotency); out-of-order (`shouldApplyStripeEvent`, created-order).

**Assertion:** zero DB write, email, analytics, entitlement, cancellation, refund
or portal mutation for foreign/unknown objects. Owned fixtures retain
idempotent/out-of-order behaviour.

## Intentional asymmetry with the peer

Mellowa's canonical tag is `app = "mellowa"` + `supabase_user_id`; Scalvya's is
`source = "launchbloom"` + `app_user_id`. The keys differ deliberately, so a
value collision on one field cannot satisfy the other app's predicate. No shared
cross-repo package is introduced — each app owns its predicate. The Scalvya→ half
and the live cross-app pairing live in `primocera/LaunchBloom` and are owner-run.
