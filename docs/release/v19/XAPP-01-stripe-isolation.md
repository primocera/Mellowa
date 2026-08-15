# XAPP-01 — Symmetric cross-app Stripe isolation at the complete object graph

**Outcome:** Scalvya and Mellowa cannot adopt each other's money events.
**Verdict:** completed (regression guard at the v19 candidate). Billing frozen — no code change.

## State found

The complete-object-graph isolation was already implemented (XAPP-V17-01 /
XAPP-V18-01) and **v19 changed no Stripe/billing code** (verified: `git diff
main..HEAD -- src/app/api/stripe src/lib/stripe` is empty). Ownership is the exact
Mellowa app namespace — `metadata.app === "mellowa"` **AND** `supabase_user_id` —
or a trusted stored-customer row. A same email, same-looking UUID, shared Stripe
account or configured price is never ownership.

The matrix (`docs/release/v17/XAPP-ISOLATION-MELLOWA.md`) already documents every
object type: Customer, Checkout session, Subscription (created/updated/deleted),
Invoice (payment_failed/succeeded), Charge (refunded), Dispute
(charge.dispute.created), Portal, PaymentIntent — each with its predicate and its
foreign-object behavior (ignored / no mutation / no email / no analytics).

## Change (Mellowa side, tests only)

- `tests/xapp-object-graph-v19.test.ts` (new, 25): a symmetric regression guard at
  the candidate —
  - the exact-app predicate is intact (`metadata.app !== MELLOWA_APP` gate + `supabase_user_id`);
  - every money-bearing event has an ownership-gated handler (subscription ×3,
    invoice ×2, charge.refunded, charge.dispute.created, checkout);
  - subscription events resolve via exact metadata or the stored row; invoice/
    charge/dispute via `userIdForCustomerId`; a foreign subscription/charge is
    ignored/another-product's-incident, never adopted;
  - the reconciler works only from OUR stored `subscriptions` rows (same ownership
    basis, never adopts a discovered foreign object);
  - the matrix doc enumerates the full object graph and contains no email/production id;
  - isolation logs carry ids/categorical reasons only, never an address.

## Cross-repo note

This proves the **Mellowa** side only. The Scalvya (LaunchBloom) equivalent runs in
that repository — this repo does not claim to prove the other. Both complete suites
must pass independently and be pinned to each app's candidate SHA.

## Rollback

Delete the new test; no billing/product code changed.
