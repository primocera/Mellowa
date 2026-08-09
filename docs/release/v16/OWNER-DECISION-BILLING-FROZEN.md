# Owner decision — billing/Stripe is FROZEN at v16 (read before writing any prompt pack)

**Decided by:** Primoz Cerar · **Date:** 2026-08-09

This note exists because the live-transaction gate has been re-opened, and the
Stripe code re-touched, in pack after pack — and each time it costs the owner
real Stripe fees to re-rehearse (~40¢, non-refundable, **every** time). That
churn stops here.

## Directives for future release packs / prompt writers

1. **Do not re-open `P0-LIVE-TRANSACTION`.** It is an owner-accepted risk in
   [`../manifest.v16.json`](../manifest.v16.json) → `acceptedRisks`, scoped to
   `public_paid`, explicitly carry-forward. Carry the acceptance; do not relist
   it as a new open blocker.
2. **Do not generate prompts or code that modify the Stripe/billing path**
   (checkout, portal, customer ownership, currency, webhooks) unless the owner
   asks in that session. Billing is frozen; changing it is what kept the live
   gate re-triggering.
3. **Do not fabricate or inflate the score.** `P0-LIVE-TRANSACTION` stays a P0
   and public paid honestly reads **7.9**. It is not to be marked
   `live_rehearsed`, nor reclassified P0→P1, to reach a higher number. A P0 is
   never accepted away in the score — by design.

## What is actually true about the live path (so it is not re-argued)

Witnessed live at v16 (2026-08-09):
- A completed real charge (Aug 1, prior €9.99 EUR price) with the subscription
  created.
- Current-code checkout session **opens** for a brand-new user. (The earlier
  "couldn't start checkout" was a legacy untagged customer tripping the
  ownership guard on an old test account — not a new-user defect.)
- Cancel-at-period-end with correct entitlement retention, verified on the
  account.

NOT witnessed live (covered by the v15/v16 order-resilient billing +
customer-ownership contract tests, green at 1500/1500):
- Completing a charge on the current €11.99 EUR price.
- The payment-failure → recovery / late-failure ordering.

The owner accepts that residual for a bounded public-paid launch and will
re-verify with one completed current-code live charge **before scaling volume** —
on the owner's own schedule, not as a per-release tax.

## The honest readiness picture at v16

- Capped beta: gated only by cutting a frozen candidate (no live charge needed).
- Public paid: **7.9**, capped by the open (but accepted) `P0-LIVE-TRANSACTION`.
- 9.5 is not reachable yet regardless — it also requires *mature* retention
  value, which a day-one launch cannot have.
