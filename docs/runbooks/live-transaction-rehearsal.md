# Live transaction rehearsal — owner-run checklist

**Owner:** Primoz. **Every step here is executed by a human against the live
project.** Claude Code never runs any of them: it must not move real money or
mutate live Stripe, Supabase, Vercel or Resend. Record evidence in the row
provided, then copy the result into `docs/launch-go-no-go-v11.md` §3.

**Why this exists:** public paid launch is **NO-GO** on `P0-LIVE-TRANSACTION`
because one real charge → cancel → reactivate → portal → refund has never been
recorded. Configured Stripe keys prove configuration, not that a charge works.
This is the single open P0 and no code change can close it.

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
  account: step 16 deletes it.

---

## Stop conditions — abort immediately if any of these occur

Stop, do not continue the script, and record what happened. Each of these is
also a rollback trigger in `launch-go-no-go-v11.md` §5.

| Condition | Why it stops the rehearsal |
|---|---|
| Any charge on a date or of an amount the user was not shown | The disclosure contract is broken; this is also an immediate stop for the trial-length experiment |
| Two charges for one checkout | Idempotency has failed; a live launch would double-bill real people |
| The app grants Premium with no subscription row, or the reverse | Entitlement is not pinned to billing state |
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
| 1 | Verified signup + email confirm | Account active. Open the confirmation link **on a second device** — the cross-device `token_hash` path was broken until v10 | __ |
| 2 | Onboarding baseline saved | Wellbeing profile persisted | __ |
| 3 | Free sample plan generated | One lifetime sample; no card requested anywhere in the flow | __ |
| 4 | One sample adjustment | Bounded, server-claimed once; a second attempt is refused | __ |
| 5 | Pricing and paywall copy | Trial length, amount and charge date agree on pricing, checkout and billing. No "a 3 days trial" — the grammar fix in v11 must be deployed | __ |
| 6 | Eligible trial checkout (live) | Exact charge disclosure shown before confirm; `subscriptions.trial_days` and `trial_variant` are pinned **before** the Stripe session is created | __ |
| 7 | Trial → first charge | €9.99 captured in Stripe on exactly the disclosed date | __ |
| 8 | Charge date matches disclosure | The date shown at step 6 is the date in Stripe. Not "about right" — the same date | __ |
| 9 | Webhook entitlement | Subscription row active; app grants Premium; no duplicate on replay | __ |
| 10 | Daily repair on a live plan | One transaction, no partial plan; completed and kept items untouched; Undo restores exactly | __ |
| 11 | Cancel (portal or `/api/stripe/cancel`) | `cancel_at_period_end`; read access retained; the trial banner stands down so two notices never contradict | __ |
| 12 | Reactivate | Subscription active again; **no second charge** | __ |
| 13 | Billing portal | Opens; shows the correct plan and next date | __ |
| 14 | Refund via Stripe | `charge.refunded` handled; entitlement adjusts on the webhook, not by hand | __ |
| 15 | `/api/cron/billing-reconcile` | `ok:true`, and `adoptedSubscriptions` is empty | __ |
| 16 | Export then delete the account | Export contains what you created; after delete, zero rows remain in every table in `src/lib/privacy/registry.ts` | __ |

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
3. **Delete** the test account through the in-app deletion flow — that is also
   step 16's evidence, and it exercises the deletion path rather than leaving
   rows behind through a manual SQL delete.
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
