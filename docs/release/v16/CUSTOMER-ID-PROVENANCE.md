# MW-95-01 — Customer-ID provenance matrix

On the SHARED Stripe account (Mellowa + Scalvya/LaunchBloom + Frost) a customer
id is only trustworthy once it is proven owned by **exact metadata**:
`metadata.app === "mellowa"` AND `metadata.supabase_user_id === <caller>`.
Presence of the id in Mellowa's own `subscriptions` table, or a shared email, is
never proof. Every path below runs the one predicate
`verifyMellowaCustomerOwnership` (`src/lib/stripe/customer.ts`) before the id can
reach Checkout or the Billing Portal.

## Where each customer id comes from, and how it is proven

| # | Source of the id | File / boundary | Verified before use? | Non-owned outcome |
|---|---|---|---|---|
| 1 | Stored `subscriptions.stripe_customer_id` | `checkout/route.ts` (stored-id guard) | ✅ retrieve + exact metadata | `mismatch` → 503 `customer_reconciliation_required` (non-retryable); `missing`/deleted → fall through to recovery; `unavailable` → 503 `billing_unavailable` (retryable) |
| 2 | Search-recovered orphan (`findMellowaCustomer`) | `checkout/route.ts` (post-recovery guard) | ✅ re-proven at the boundary | non-owned → 503 (mismatch=reconcile / else billing_unavailable) |
| 3 | Freshly created (`customers.create` + idempotency key + `app`/`user` metadata) | `checkout/route.ts` (post-recovery guard) | ✅ re-proven at the boundary | as #2 — a create anomaly can never reach Checkout unverified |
| 4 | Concurrent-race **winner** re-read from the row | `checkout/route.ts` (confirm-row guard) | ✅ retrieve + exact metadata | non-owned → 503 (mismatch=reconcile / else billing_unavailable); never adopted |
| 5 | Stored id for the Billing Portal | `portal/route.ts` (ownership guard) | ✅ retrieve + exact metadata | non-owned → 503 (unavailable=billing_unavailable retryable, else customer_reconciliation_required non-retryable); portal never opened |

## Ownership predicate outcomes (`CustomerOwnership`)

| Retrieve result | Verdict | Meaning |
|---|---|---|
| `app=mellowa` + matching `supabase_user_id` | `owned` | safe to charge / manage |
| live customer, any other metadata (foreign app, wrong user, untagged) | `mismatch` | fail closed, owner reconcile — never auto-repair |
| `resource_missing` or `deleted` | `missing` | recoverable orphan (search → reuse/create → relink) |
| transient retrieve error | `unavailable` | fail closed, retryable |

Default deny: only an exact-metadata match yields `owned`; every other state
fails closed.

## Test evidence

- `tests/customer-ownership.test.ts` — table-driven predicate (owned,
  foreign-app, wrong-user, missing-app, missing-user, no-metadata, deleted,
  resource_missing, transient) + portal-route parity (owned opens; foreign /
  wrong-user / missing → non-retryable 503; transient → retryable 503; id and
  raw provider message never leak).
- `tests/checkout-customer-idempotency.test.ts` — ownership on the **stored** and
  concurrent-**winner** paths (owned reuse/adopt; foreign & wrong-user reconcile;
  resource_missing recovers via create; transient → billing_unavailable), plus
  the existing MW-02 idempotency/recovery proofs.

Gates at this change: `vitest` 1419/1419, `tsc --noEmit` clean, `eslint` clean,
`next build` compiled.
