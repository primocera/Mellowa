# v16 — release status (generated)

> Generated from `docs/release/manifest.v16.json` by `scripts/render-release-status.mjs`. Do not edit by hand — a contract test regenerates this and fails on any drift.

- **Candidate:** no frozen candidate — baseline e40737b (draft)
- **Baseline:** `e40737b2a872e70a168f1e88eb1a08d87f415579`
- **Reconciled:** 2026-08-15T00:00:00Z
- **Migrations:** 51 (001–051)

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
| P0-LIVE-TRANSACTION | P0 | public_paid | A live payment failure to recovery and the late-failure-after-recovery ordering have not been witnessed over a live wire at v16. |

## Owner-run evidence

| Id | Status | Action |
|---|---|---|
| authenticated-e2e-matrix | local_pass | Run the full authenticated E2E matrix once, unattended, against a throwaway non-production Supabase, pinned at the frozen candidate SHA. |
| live-transaction | not_run | One real low-value transaction end to end on live Stripe: charge, cancel, reactivate, payment recovery, refund, per docs/runbooks/live-transaction-rehearsal.md. |

## Rollback

Flag-based and data-safe. FLAG_PLAN_REPAIR=0, FLAG_WEEKLY_REFLECTION=0, FLAG_TRIAL_LENGTH_EXPERIMENT=0, plus per-surface UI reverts and the beta-capacity intake switch. Every migration is additive and re-runnable. Code rollback target for the shipped product line is 6fe3980 (v14).

