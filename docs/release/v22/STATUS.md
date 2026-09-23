# v22 — release status (generated)

> Generated from `docs/release/manifest.v22.json` by `scripts/render-release-status.mjs`. Do not edit by hand — a contract test regenerates this and fails on any drift.

- **Candidate:** RC 2543a38 (promoted)
- **Baseline:** `30646b3c1590f73a1693e3dbc9aa2a87b8da9f9b`
- **Reconciled:** 2026-09-23T04:30:00Z
- **Migrations:** 54 (001–054)

## Verdicts

| Tier | Verdict |
|---|---|
| Automated code gate | GO |
| Capped beta | GO |
| Public paid | GO |
| Scale expansion | GATHERING DATA |

## Required gates

| Suite | Command | Status |
|---|---|---|
| lint | `npm run lint` | ci_pass |
| typecheck | `npm run typecheck` | ci_pass |
| unit-contract-safety | `npx vitest run` | ci_pass |
| eval-gate | `npm run eval` | ci_pass |
| production-build | `npm run build` | ci_pass |
| dependency-audit | `npm audit --omit=dev` | ci_pass |
| e2e-public | `npm run test:e2e:public` | ci_pass |
| e2e-authenticated | `npm run test:e2e:matrix` | ci_pass |
| release-check | `npm run release-check` | live_rehearsed |

## Open blockers

_None open._

## Owner-run evidence

| Id | Status | Action |
|---|---|---|
| migrations-050-054-applied | live_rehearsed | Confirm production migrations 050-054 are applied and verified via the exact schema/index/RPC probes in scripts/verify-migrations-050-054.sql and /api/health/ready (paid mode). |
| billing-reconcile-fresh | live_rehearsed | Fire billing-reconcile once on the deployed SHA so cron_billing_reconcile_freshness=ok in paid readiness. |
| authenticated-e2e-matrix | ci_pass | Run the full authenticated E2E matrix once, unattended, against a throwaway non-production Supabase, pinned at the frozen candidate SHA. |
| secret-rotation | live_rehearsed | Rotate the previously-exposed weak credentials (ADMIN_STATS_SECRET, CRON_SECRET) to random values, update the cron scheduler to match, and redeploy. Record rotation metadata only. |
| live-transaction | live_rehearsed | One real low-value transaction end to end on live Stripe: charge, cancel, reactivate, payment recovery, refund, per docs/runbooks/live-transaction-rehearsal.md. |

## Rollback

v24 is release tooling + tests + docs only (no runtime change vs 1b7dfef). Roll back by redeploying the previous production deployment; runtime-identical rollback target is 1b7dfef (v23 promoted RC). Migrations 050-054 are additive with data-safe rollbacks recorded in each file.

