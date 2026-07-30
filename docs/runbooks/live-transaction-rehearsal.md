# Live transaction rehearsal — owner-run checklist

**Owner:** Primoz. **Every step here is executed by a human against the live
project.** Claude Code never runs any of them: it must not move real money or
mutate live Stripe, Supabase, Vercel or Resend. Record evidence in the row
provided, then copy the result into `docs/launch-go-no-go-v11.md` §3.

**Why this exists:** `P0-LIVE-TRANSACTION` is open because one real charge →
cancel → reactivate → recovery → refund has never been recorded. Configured
Stripe keys prove configuration, not that a charge works, and no code change can
close it. The refund also happens in **Cleanup**, on every run, passed or
aborted.

> **v12 note (MW-V12-01/03):** RC `0025a502` is **superseded** and every tier
> now reads **UNASSESSED** in `docs/release/manifest.v11.json`. The billing
> hardening in MW-V12-03 (order-resilient invoice handling, foreign-product
> isolation) makes the failure→recovery→late-failure path safe *in code*, but a
> contract test does not close owner evidence: this rehearsal stays required.
> Record the result against `P0-LIVE-TRANSACTION` in the manifest's
> `ownerEvidence` when the new candidate is cut (MW-V12-09). The
> `launch-go-no-go-v11.md` §3 rows below are the superseded record.

**Evidence hygiene — read before writing in any row.** Record opaque
identifiers only: Stripe object ids (`sub_…`, `pi_…`, `re_…`), timestamps, and
statuses. Never record the card number or any part of it, the account's real
email, a plan's contents, a check-in, or a screenshot showing them. If a
screenshot is genuinely needed, redact the address bar and any plan text first.
This file is committed to the repository.

**Pre-conditions**
- Live Stripe in live mode: secret key, webhook endpoint
  (`/api/stripe/webhook`, subscribed events) with its signing secret, live EUR
  prices `STRIPE_PRICE_PRO_MONTHLY` (€9.99) and `STRIPE_PRICE_PRO_YEARLY`
  (€59.99).
- Migrations `001`–`039` applied to the live project — confirm with
  `/api/health/ready`, which checks the RPC overloads the app actually calls,
  not just that two tables exist.
- `npm run release-check` run with production env pulled, reporting ready.
- A disposable real payment method you control, and the Stripe dashboard open on
  the refund screen before you start.
- A clearly synthetic account. Do not use a real customer or your own primary
  account: Cleanup deletes it.

---

## Stop conditions — abort immediately if any of these occur

Stop, do not continue the script, and record what happened. Each of these is
also a rollback trigger in `launch-go-no-go-v11.md` §5.

| Condition | Why it stops the rehearsal |
|---|---|
| A charge in any currency other than EUR | Stripe does not convert; a EUR-promised, USD-charged customer is the exact P0-PRICE-CURRENCY defect. Verify with `npm run verify-prices` before starting |
| Any charge on a date or of an amount the user was not shown | The disclosure contract is broken; this is also an immediate stop for the trial-length experiment |
| An amount that is not €9.99 (monthly) or €59.99 (yearly) | The charged price disagrees with the billing contract |
| Two charges for one checkout | Idempotency has failed; a live launch would double-bill real people |
| The app grants Premium with no subscription row, or the reverse | Entitlement is not pinned to billing state |
| A Scalvya/Frost (foreign-product) event mutating a Mellowa row, sending Mellowa mail, or appearing in Mellowa analytics | Cross-product isolation has failed on the shared Stripe account |
| Any email the flow did not expect — a second welcome, a reminder after unsubscribe, a lifecycle mail for someone else | Delivery is not pinned to the event that should trigger it |
| A reconcile report containing `adoptedSubscriptions` | Webhooks are being dropped and users are paying without access |
| Any plan, meal, check-in or journal text appearing in an email subject or preview | Privacy gate failure |
| A safety-blocked input producing a plan, consuming entitlement, or showing an upsell | Safety gate failure — the hardest stop on this list |

If you abort, go straight to **Cleanup** below. An aborted rehearsal is recorded
as FAIL with the reason; it is never recorded as "partially passed".

---

## Steps

Fill **both** columns. "Expected" is what should happen; "Observed" is what did.
A row where the two differ is a finding even if the flow continued.

| # | Step | Expected | Observed |
|---|---|---|---|
| 1 | Live checkout and first charge | Exact charge disclosure shown before confirm; €9.99 captured in Stripe on exactly the disclosed date; webhook grants Premium with no duplicate row | __ |
| 2 | Cancel (billing portal or `/api/stripe/cancel`) | `cancel_at_period_end`; read access retained until period end; the trial banner stands down so two notices never contradict | __ |
| 3 | Unsubscribe from optional email | Suppression recorded; the daily reminder stops; billing and account mail still arrives | __ |
| 4 | Reactivate | Subscription active again; **no second charge** | __ |
| 5 | Payment failure then recovery (Stripe test clock, or a card set to fail then succeed) | `invoice.payment_failed` sets `past_due` and sends the failure mail; the recovery `invoice.payment_succeeded` returns the row to `active` and sends the recovery mail; entitlement follows Stripe, not arrival order | __ |
| 6 | Late failure after recovery — redeliver the step-5 `payment_failed` from the Stripe dashboard **after** the recovery | The redelivered older event is dropped by `event.created` order; the account stays `active`; no failure mail is re-sent | __ |
| 7 | Refund (Stripe dashboard) | Full refund captured; `charge.refunded` webhook applied; `payment_refunded` recorded for this user only; entitlement unchanged until Stripe emits its own subscription event | __ |

Step 6 is the one people skip, and it is the residual risk recorded against
`P0-LIVE-TRANSACTION`. The ordering guard that makes it safe is
`src/lib/stripe/event-order.ts` (`shouldApplyStripeEvent`), unit-tested in
`tests/billing-lifecycle-order.test.ts`. The live step confirms the guard holds
against a real redelivery, which a test cannot.

## Idempotency and safety spot-checks

- [ ] Replay one webhook event → no duplicate charge, generation or entitlement
      change. (`claim_stripe_event` should report it as a duplicate.)
- [ ] Deliver a webhook **out of order** (older `event.created` after a newer
      one) → the newer state wins.
- [ ] Double-tap repair, and retry after a timeout → no double repair, no double
      bill, no double generation claimed.
- [ ] Blocked or crisis input during the trial → no generation, no entitlement
      consumed, **no upsell anywhere on the response**.
- [ ] An allergen conflict → the plan is refused rather than served with a
      warning.

## Alert thresholds to watch during and after the run

These are the numbers that should make you stop and look, taken from the admin
delivery-health and billing-health views. They are deliberately low: this is one
synthetic account, so any non-zero value is a signal, not noise.

| Signal | Threshold | Where |
|---|---|---|
| `adoptedSubscriptions` in a reconcile report | any | `/api/cron/billing-reconcile` |
| Duplicate-customer detections | any | billing health |
| Email dead letters | any | `/admin` delivery health |
| Outbox backlog older than one send window | any | `/admin` delivery health |
| Stuck webhooks (received, never applied) | any | billing health |
| AI daily-ceiling denials | any during a single-account run | `/admin` cost scorecard |

## Cleanup

Do this whether the run passed or aborted.

1. **Refund** the charge in Stripe if it is still captured, and confirm the
   refund webhook applied.
2. **Cancel** the subscription so nothing renews.
3. **Delete** the test account through the in-app deletion flow rather than
   leaving rows behind through a manual SQL delete.
4. Confirm `/admin` shows no lingering backlog or dead letters attributable to
   the run.

## Rollback

Nothing in this rehearsal changes code, so rollback is operational rather than a
revert. If the run reveals a defect, the flag-based paths in
`launch-go-no-go-v11.md` §5 apply: `FLAG_PLAN_REPAIR=0` disables repair,
`FLAG_TRIAL_LENGTH_EXPERIMENT=0` stops new assignment (pinned trials complete
exactly as disclosed — no live subscription is re-timed), and intake can be
closed through the beta capacity switch without deleting anything.

## Result

- Date run: ____ · Operator: ____
- Outcome: **PASS / FAIL** (attach opaque evidence ids only — no customer data)
- If any row's Observed differs from Expected, the outcome is FAIL even if the
  flow completed.
- On PASS: copy the evidence into `docs/launch-go-no-go-v11.md` §3 against
  `P0-LIVE-TRANSACTION`. Only then may the paid verdict be revisited, and only
  by a human.
