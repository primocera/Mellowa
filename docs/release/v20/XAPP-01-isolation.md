# XAPP-01 — shared-Stripe object-graph isolation (cross-repo evidence)

> Two independent products share ONE Stripe account. This document reports the
> **Mellowa** side, pinned to its own SHA. Scalvya is a separate repository with a
> separate SHA, database, deploy and candidate — evaluated independently against
> the same fixture matrix. **The two are never combined.**

## Mellowa side — pinned evidence
- **Repository:** `github.com/primocera/Mellowa`, branch `v20`.
- **SHA:** the current v20 branch HEAD (see the commit that adds this file).
- **Ownership predicate (unchanged in v20; Stripe code frozen at v16):** a Stripe
  object belongs to Mellowa **only** when `metadata.app === "mellowa"` AND its
  `metadata.supabase_user_id` matches — or it resolves to our own stored customer
  row. **Email and price ids are never sufficient ownership proof** on a shared
  account. Foreign / untagged / ambiguous events are **acknowledged-and-dropped**
  (Stripe retry would be harmful), and a temporarily unreadable ownership check
  returns a retryable error rather than adopting or discarding.

## Negative fixture matrix (all → zero adoption)
Verified at the v20 SHA by `tests/xapp01-shared-stripe-isolation.test.ts` plus the
carried v17/v19 matrices (`cross-app-isolation`, `webhook-isolation`,
`xapp-isolation`, `xapp-object-graph-v19`, `xapp-ownership-matrix`,
`xapp02-release-sweep-v19`, `customer-ownership` — 101 tests, green):

| Fixture | Result |
|---|---|
| exact Mellowa (app+user) | **owned** (the only adopt) |
| exact Scalvya | mismatch — no adoption |
| Frost / unknown app | mismatch |
| unstamped (no metadata) | mismatch |
| bare `supabase_user_id`, no `app` | mismatch |
| same email, no app | mismatch |
| same price, no app | mismatch |
| conflicting stamp: mellowa app, wrong user | mismatch |
| ambiguous legacy: user id, blank app | mismatch |
| deleted customer | missing (recover to a live owned one) |
| transient read failure | unavailable (retryable) |
| same human using both apps | isolated per app+user |

**Asserted zero** across customer, checkout, subscription, invoice, payment,
charge, refund, dispute, portal, cancellation, deletion and reconciliation
consumers: no foreign write, entitlement, lifecycle email, portal session,
cancellation, refund, deletion or reconcile adoption. Ambiguous objects block
paid expansion and remain visible for owner reconciliation.

## Residual / asymmetric risk
- Scalvya historically retained price/email legacy fallbacks and requires its own
  SV-01 migration/sunset; that is a **Scalvya-repo** action and does not weaken
  Mellowa's exact policy. Do not weaken Mellowa's predicate to accommodate it.
- Production Stripe inventory (the real objects in the live account) is **not**
  verified here — that is owner evidence (a live foreign-event rehearsal is in
  `docs/runbooks/v20-rehearsals.md`, NOT RUN).

## Handoff
Mellowa passes the isolation contract at its exact v20 SHA. The XAPP-FINAL plan
(`docs/release/v20/XAPP-FINAL-launch-plan.md`) keeps the two apps' candidates,
evidence and cohorts independent and never opens both public-paid launches at once.
