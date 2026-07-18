# Billing operations (Launch v6, Prompt 18)

## The one billing state machine

Local `subscriptions.status` mirrors Stripe exactly; the app never invents a
state. Access is decided only by `entitlementFor(status)` (src/lib/stripe/plans.ts):

```
none ──checkout──▶ trialing ──trial end, payment ok──▶ active
                     │  ▲                              │  ▲
                     │  └──── reactivate ◀─────────────┤  │ invoice paid
                     │ cancel_at_period_end            ▼  │ (recovered)
                     └──period end──▶ canceled     past_due ──retries exhausted──▶ unpaid/canceled
```

- **trialing / active** → full generate + read access.
- **past_due** → read access, no new generation; Stripe Smart Retries run per
  dashboard settings; recovery flips back to active (webhook + reconcile).
- **canceled / unpaid / none** → read access to saved content, sample tier.
- The customer always sees which state they're in and the exact date it
  changes on /billing (trial charge date, renewal date, access-until date on
  cancel, past-due notice).

## Reconciliation

`/api/cron/billing-reconcile` (Bearer CRON_SECRET, daily via cron-job.org)
fetches every local subscription from Stripe, fixes drift (Stripe wins) and
reports exceptions: unresolvable subscriptions, duplicate Stripe customers,
unknown price ids, failed/stuck webhook events. It returns HTTP 500 when
exceptions exist so the pinger's own failure alerting fires — no extra email
infrastructure. Manual run:
`curl -X POST https://mellowa.app/api/cron/billing-reconcile -H "Authorization: Bearer $CRON_SECRET"`.

Unknown prices also hard-fail in the webhook itself (event marked failed,
Stripe retries) — a misconfigured price can never silently grant or deny.

## Cancellation

Self-serve on /billing: confirmation shows the exact access-end date, reason
is an optional closed-enum select ("Prefer not to say" is the default — never
a forced survey), no guilt copy. Reactivation available until period end.
Voluntary vs involuntary churn is tagged server-side on
`customer.subscription.deleted` (`churn_type` property); renewal revenue is
tracked via `subscription_renewed` events.

## Refunds

Intake: "Request a refund" on /billing (mailto with subject "Refund request")
or any support email. Process:

1. Look the user up in /admin/users; **Flag for billing review** with the
   ticket reason (this is the audit record).
2. Check eligibility against /refund policy — but **never auto-deny statutory
   rights** (EU 14-day withdrawal etc. always honored).
3. Issue the refund in the Stripe dashboard (customer link is on the console).
4. Clear the billing-review flag with an outcome reason; reply with the
   refund confirmation macro (docs/support-runbook.md).

Honest limit: refund execution is manual in the Stripe dashboard by design at
solo-operator scale; the console records intake/outcome, Stripe records the
money movement.

## Alerts to watch

- Reconcile pinger failures (drift/duplicates/unknown prices/stuck webhooks).
- Stripe dashboard: disputed charges + refund rate — check weekly; a refund
  or chargeback rate above ~2% of active subscribers is an incident.
- /admin stats for payment_failed vs payment_recovered trend (involuntary
  churn pressure).

## Stripe dashboard settings that this design assumes

- Smart Retries enabled (default dunning), subscription set to cancel after
  retries are exhausted.
- Customer emails for failed payments can stay off — Mellowa sends its own
  payment_failed email via the outbox.
