# Metrics & reporting (Launch & Scale v6, Prompt 10)

Decision-ready daily/weekly metrics built on the analytics contract
(`docs/analytics.md`). Pure transforms live in `src/lib/analytics/metrics.ts`;
the server report in `src/lib/analytics/report.ts`; the dashboard at `/admin`.

## Access

- **Dashboard `/admin`** — real per-user authorization: the signed-in Supabase
  user id must be in `ADMIN_USER_IDS`. Non-admins get a 404 (existence hidden).
  CSV export at `/admin/export` uses the same cookie auth.
- **API `/api/admin/stats`** — programmatic access, gated by the shared
  `ADMIN_STATS_SECRET` bearer. `?window=<days>&release=<tag>&format=csv|json`,
  `?view=raw` for the legacy count payload.

## Metric definitions

| Metric | Definition |
|--------|-----------|
| Funnel step (`reached`) | Distinct subjects (user id, else anon id) who fired the step event in the window. Counted once per step — no double-counting. |
| Sample → trial | distinct `trial_started` ÷ distinct `sample_plan_generated` |
| Trial → paid | distinct `trial_converted` ÷ distinct `trial_started` |
| Retention D1/D7/D30 | Of subjects activated (`sample_plan_generated`), share with a return event (`checkin_completed`/`plan_generated`) N days later (±1 day). |
| Voluntary churn | distinct `trial_canceled` |
| Involuntary churn | distinct `payment_failed` |
| MRR (est.) | active paid subs at published prices, yearly ÷ 12. **Excludes Stripe fees & refunds.** |
| Contribution / payer | (MRR − AI cost) ÷ active payers. Estimate, not net margin. |
| Fallback rate | `plan_fallback_served` ÷ (`plan_generated` + `plan_fallback_served`) |

## Guardrails

- **Small-cohort suppression:** any figure derived from fewer than
  `MIN_COHORT = 5` distinct people is returned as `null` (shown as “—”), so a
  metric can never expose an individual.
- **Reconciliation:** event-derived counts are checked against the
  system-of-record (`daily_plans`, `subscriptions`). A mismatch beyond tolerance
  is surfaced as `MISMATCH`, never hidden — it means an event is missing or
  double-fired.
- **Anomaly alerts:** a funnel step more than 40% below the previous equal-length
  window (with a meaningful baseline) is flagged on the dashboard.

## Data freshness

Computed live per request from `app_events`, `subscriptions`, `ai_usage_events`,
`daily_plans` and `safety_events`. No rollup lag; heavier pre-aggregated rollups
can be added later if query volume grows.

## Known limits (owned by LS-11)

Latency (p50/p95) and per-model / per-prompt-version generation breakdown are
**not** here — the `ai_usage_events` ledger doesn't yet record them. LS-11 adds
that telemetry; `generationHealth` currently reports generated / fallback /
safety-blocked / fallback-rate from the existing ledgers.

## Operational follow-up

- Set `ADMIN_USER_IDS` (comma-separated Supabase user ids) in the deployment env
  to grant dashboard access. Unset = nobody can see `/admin` (fail-closed).
