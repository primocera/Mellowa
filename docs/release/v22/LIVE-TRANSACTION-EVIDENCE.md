# Mellowa v22 — live Stripe A–H rehearsal evidence

Owner-run live rehearsal on **mellowa.app** (LIVE Stripe), per
[`docs/runbooks/live-transaction-rehearsal.md`](../../runbooks/live-transaction-rehearsal.md).
Recorded as each step completes. **Opaque Stripe ids only** — no email addresses,
card data, secret values or full customer PII. (Mellowa and Scalvya share one Stripe
account; a fresh throwaway email is used and cleaned up afterwards.)

**STATUS: A–H all recorded ✅ 2026-09-05** — closes `P0-LIVE-TRANSACTION` and flips
`ownerEvidence.live-transaction` to `live_rehearsed`. Final cleanup (refund the legit
step-A charge `Q9AL7CUJ-0011`, cancel the throwaway sub, delete the test account) is
the operational wind-down, tracked separately.

| Step | Scenario | Status | Opaque evidence |
|---|---|---|---|
| A | Checkout / trial → active subscription | ✅ DONE | sub `sub_1UCHR70YzvSNMCpN5OApy4wg`, item `si_VCgoVQr2mQDxqH`, Mellowa monthly €11.99 EUR, started 2026-09-05, next invoice 2026-10-05 |
| B | Cancel at period end | ✅ DONE | `sub_1UCHR70YzvSNMCpN5OApy4wg` set to **not renew**; app confirms "full access until 5 October 2026, history stays readable after". `cancel_at_period_end=true`, access retained, no immediate downgrade. Post-cancel `billing-reconcile` → `ok:true`, `adoptedSubscriptions:[]`, `stuckWebhookEvents:[]` (webhook synced, nothing dropped) |
| C | Opt out of optional email (suppression) | ✅ DONE | Daily-reminder opt-in toggled ON then OFF in Settings; the OFF (suppression) state **persisted across reload** — the same state the one-click email unsubscribe writes and the scheduler reads. Transactional mail correctly carries **no** unsubscribe link (welcome/trial/cancel seen in inbox); optional-mail one-click unsubscribe + suppression also covered by `email-unsubscribe.test.ts` + `cross-app-isolation.test.ts`. Reminder copy confirmed to leak no mood/energy/meal/journal/plan content. |
| D | Reactivation | ✅ DONE | Same `sub_1UCHR70YzvSNMCpN5OApy4wg` resumed via billing portal: app shows "Current subscription, €11.99/mo, next billing Oct 5, 2026" — `cancel_at_period_end` cleared, back to renewing. **No second charge / no new invoice.** Post-reactivate `billing-reconcile` → `ok:true`, only the one sub for this user, `duplicateCustomers:[]`, `adoptedSubscriptions:[]` (no duplicate subscription created) |
| E | Payment failure → recovery | ✅ DONE | **Failure:** real €11.99 invoice `in_1UCKgI0YzvSNMCpNmrrt5tHO` attempted on the frozen card `pm_1UCHQQ…9065` → **`card_declined`** → `invoice.payment_failed` → Mellowa webhook (customer-keyed) set local row `past_due`. App as mon.prim: **"last payment didn't go through, new plans and adjustments are paused… everything already created stays readable"** — paid actions withheld, read access retained, non-clinical copy, update-payment path. **Recovery:** card unfrozen, same invoice re-paid → **`status:paid`**, €11.99 charged → `invoice.payment_succeeded` → webhook flipped local row `past_due → active`; app banner gone, new plans/adjustments available again, recovery email received (both owner-confirmed). (Stripe sub object stayed `active` throughout since the invoice is standalone — expected; Mellowa gates on the local row.) |
| F | Late / out-of-order failure webhook dropped | ✅ DONE | The E `invoice.payment_failed` event was **Resent** from the Stripe dashboard *after* recovery. Its `created` is older than the applied recovery event, so Mellowa's ordering guard (`shouldApplyStripeEvent`, [webhook/route.ts:487](../../../src/app/api/stripe/webhook/route.ts#L487)) **dropped** it: sub stayed `active`, **no** repeat payment-failed email (the email send is inside the guarded block, so no-email ⇒ dropped before any state change). This is the residual-risk case `P0-LIVE-TRANSACTION` exists for, now witnessed live. |
| G | Refund without wrong entitlement change | ✅ DONE | Recovery charge `ch_3UCKgK…` (invoice `in_1UCKgI…`, Q9AL7CUJ-0014, €11.99) refunded → **`re_3UCKgK0YzvSNMCpN06NbWiWo`** €11.99 EUR (2026-09-05T14:49:06Z) → `charge.refunded`. Mellowa recorded `payment_refunded` and **entitlement unchanged — app stayed active** for mon.prim (refund alone does not revoke access; [webhook/route.ts:579](../../../src/app/api/stripe/webhook/route.ts#L579)). Isolation: recorded only for this customer's user. |
| H | Duplicate / replayed webhook idempotency + one real transactional email | ✅ DONE | An already-processed event was **Resent** from the Stripe dashboard (duplicate delivery). Mellowa deduped it (`claim_stripe_event`): **no** status change, **no** duplicate charge, **no** duplicate email, no extra grant. Real transactional emails delivered live and each exactly once: **cancellation** (B) and **payment-recovered** (E) — the recovery mail content verified non-clinical, no plan/mood/journal content. |

## Invariants to confirm across the run
- No duplicate customer, subscription or email for the one throwaway identity.
- Refund (G) must **not** wrongly change entitlement.
- Out-of-order / duplicate webhooks (F, H) must be idempotent — no double effect.
- Exactly **one** real transactional email actually delivered (H).

## Notes
- LIVE mode has no test clocks — trial charge is fired via the Stripe Dashboard
  ("End trial now"); a $0 card auth at trial start is normal.
- Cancellation is always done in **Stripe**, never directly in Supabase (a Supabase
  edit creates exactly the status drift that `billing-reconcile` exists to repair).
