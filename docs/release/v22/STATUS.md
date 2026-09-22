# v22 — release status (generated)

> Generated from `docs/release/manifest.v22.json` by `scripts/render-release-status.mjs`. Do not edit by hand — a contract test regenerates this and fails on any drift.

- **Candidate:** RC 1b7dfef SUPERSEDED
- **Baseline:** `30646b3c1590f73a1693e3dbc9aa2a87b8da9f9b`
- **Reconciled:** 2026-09-22T18:00:00Z
- **Migrations:** 54 (001–054)

## Verdicts

| Tier | Verdict |
|---|---|
| Automated code gate | UNASSESSED |
| Capped beta | UNASSESSED |
| Public paid | UNASSESSED |
| Scale expansion | GATHERING DATA |

UNASSESSED is not a weak GO. No candidate is frozen, so no verdict can be read from the gates until one is cut via the immutable release-candidate workflow.

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

| Id | Level | Blocks | Title |
|---|---|---|---|
| P0-V24-DEPLOY-PARITY | P0 | capped_beta, public_paid | Deploy drift + superseded RC: production /api/health serves f0dbcf5 while the promoted RC is 1b7dfef, and v24 release-tooling commits move the product tree past the frozen candidate. |

## Owner-run evidence

| Id | Status | Action |
|---|---|---|
| migrations-050-054-applied | live_rehearsed | Confirm production migrations 050-054 are applied and verified via the exact schema/index/RPC probes in scripts/verify-migrations-050-054.sql and /api/health/ready (paid mode). |
| billing-reconcile-fresh | live_rehearsed | Fire billing-reconcile once on the deployed SHA so cron_billing_reconcile_freshness=ok in paid readiness. |
| authenticated-e2e-matrix | ci_pass | Run the full authenticated E2E matrix once, unattended, against a throwaway non-production Supabase, pinned at the frozen candidate SHA. |
| secret-rotation | live_rehearsed | Rotate the previously-exposed weak credentials (ADMIN_STATS_SECRET, CRON_SECRET) to random values, update the cron scheduler to match, and redeploy. Record rotation metadata only. |
| live-transaction | live_rehearsed | One real low-value transaction end to end on live Stripe: charge, cancel, reactivate, payment recovery, refund, per docs/runbooks/live-transaction-rehearsal.md. |

## Rollback

The v23 change is a dependency-only security patch (next 16.3.5, eslint-config-next matched, sharp override 0.35.4, baseline-browser-mapping 2.11.x in package.json + package-lock.json) plus release-gate tooling/docs; no product logic and no Stripe/billing code changed (frozen at v16), no migration added. Roll back by reverting to the previous deployment / restoring the prior package.json + package-lock.json. All 050-054 migrations are additive and reversible with a data-safe rollback recorded in each file. Code rollback target is the previous promoted RC.

