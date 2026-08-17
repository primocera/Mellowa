# v20 — release status (generated)

> Generated from `docs/release/manifest.v20.json` by `scripts/render-release-status.mjs`. Do not edit by hand — a contract test regenerates this and fails on any drift.

- **Candidate:** no frozen candidate — baseline 5fea5a9 (draft)
- **Baseline:** `5fea5a98e763876c16a07f3ad63448a8e68b9bbd`
- **Reconciled:** 2026-08-17T00:00:00Z
- **Migrations:** 54 (001–054)

## Verdicts

| Tier | Verdict |
|---|---|
| Automated code gate | UNASSESSED |
| Capped beta | UNASSESSED |
| Public paid | UNASSESSED |

UNASSESSED is not a weak GO. No candidate is frozen, so no verdict can be read from the gates until one is cut via the immutable release-candidate workflow.

## Required gates

| Suite | Command | Status |
|---|---|---|
| lint | `npm run lint` | not_run |
| typecheck | `npm run typecheck` | not_run |
| unit-contract-safety | `npx vitest run` | not_run |
| eval-gate | `npm run eval` | not_run |
| production-build | `npm run build` | not_run |
| e2e-public | `npm run test:e2e:public` | not_run |
| e2e-authenticated | `npm run test:e2e:matrix` | blocked |
| release-check | `npm run release-check` | blocked |

## Open blockers

| Id | Level | Blocks | Title |
|---|---|---|---|
| P0-V20-MIGRATIONS-APPLIED | P0 | capped_beta, public_paid | v20 migrations 050-054 are required by current product code and are not proven applied to production. |
| P0-V20-RC-NOT-CUT | P0 | automated_code_gate, capped_beta, public_paid | No immutable release candidate has been cut at a v20 SHA; ordinary CI success cannot promote the manifest. |
| P1-V20-AUTH-E2E-AT-HEAD | P1 | capped_beta, public_paid | The authenticated E2E matrix has not been observed at a v20 candidate SHA with 050-054 applied. |
| P0-LIVE-TRANSACTION | P0 | public_paid | The full live payment failure-to-recovery/refund ordering has not been witnessed over a live wire; carried forward from v16 as an owner-accepted risk for public paid. |

## Owner-run evidence

| Id | Status | Action |
|---|---|---|
| migrations-050-054-applied | not_run | Apply v20 migrations 050-054 to production Supabase per docs/release/v20/MIGRATION_PLAN.md, then verify each with the recorded query. |
| authenticated-e2e-matrix | not_run | Run the full authenticated E2E matrix once, unattended, against a throwaway non-production Supabase with 050-054 applied, pinned at the frozen candidate SHA. |
| live-transaction | not_run | One real low-value transaction end to end on live Stripe: charge, cancel, reactivate, payment recovery, refund, per docs/runbooks/live-transaction-rehearsal.md. |
| cron-rehearsal | not_run | Configure the external pingers and observe a durable success in cron_runs for each external job, then confirm cron_*_freshness=ok in paid readiness (MW-05 checklist in docs/ops-cron.md). |

## Rollback

Every v20 migration (050-054) is additive and reversible with a data-safe rollback recorded in its file and in docs/release/v20/MIGRATION_PLAN.md. No Stripe code changed (frozen at v16). Code rollback target for the shipped product line remains the last promoted RC; v20 is not promoted.

