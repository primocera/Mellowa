# Tabletop exercise log (Launch v6, Prompt 24)

Recorded desk-check drills. Each is a walk-through against the runbooks, not a
production test — that is LS-25's job. Owner: Primoz.

## TT-1 — Provider outage (2026-07-18)
- **Scenario:** AI provider returns 529 for all generation for 20 minutes.
- **Walk-through:** Circuit breaker opens after threshold; `generateStructuredJson`
  degrades to curated fallback; `plan_fallback_served` rises; users still get a
  plan. Confirmed breaker + fallback paths exist in
  `src/lib/ai/circuit-breaker.ts` and the daily-plan route.
- **Gaps found:** fallback rate has no automated alert (no CI/monitoring email
  by rule). **Action/owner:** watch `/admin` fallback metric during beta —
  Primoz, ongoing.
- **Evidence:** model-policy + circuit-breaker unit tests green.

## TT-2 — Billing drift (2026-07-18)
- **Scenario:** a `customer.subscription.updated` webhook is dropped; local row
  shows `trialing` while Stripe is `active`.
- **Walk-through:** `/api/cron/billing-reconcile` fetches Stripe, detects status
  drift, updates the local row, returns `ok:false` (HTTP 500) so the pinger
  alerts. Operator flags the user for billing review. Matches docs/billing-ops.md.
- **Gaps found:** reconcile pinger not yet configured on cron-job.org.
  **Action/owner:** add daily pinger before public launch — Primoz.
- **Evidence:** `tests/billing-ops.test.ts` drift + duplicate detection green.

## TT-3 — Accidental sensitive logging (2026-07-18)
- **Scenario:** a new email trigger risks putting mood/journal text into a
  subject or provider metadata.
- **Walk-through:** `EMAIL_CATEGORIES` + `tests/lifecycle-emails.test.ts` assert
  no template mentions mood/stress/allergies/journal and that eligibility reads
  only server state, not wellbeing tables. Analytics taxonomy is a closed enum;
  `/api/events` rejects free-text properties. Confirmed a leak would fail tests
  before shipping.
- **Gaps found:** none in code paths; residual risk is a future dev bypassing
  the helpers. **Action/owner:** keep the static tests as the gate — Primoz.
- **Evidence:** lifecycle-emails + analytics-contract tests green.

## Next drills before public paid launch
- Data-exposure key-rotation drill (execute a real `SUPABASE_SERVICE_ROLE_KEY`
  rotation and confirm the app recovers).
- Refund path end-to-end in Stripe test mode.
