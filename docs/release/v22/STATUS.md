# v22 — release status (generated)

> Generated from `docs/release/manifest.v22.json` by `scripts/render-release-status.mjs`. Do not edit by hand — a contract test regenerates this and fails on any drift.

- **Candidate:** RC faf5d16 (promoted)
- **Baseline:** `30646b3c1590f73a1693e3dbc9aa2a87b8da9f9b`
- **Reconciled:** 2026-09-05T15:30:00Z
- **Migrations:** 54 (001–054)

## Verdicts

| Tier | Verdict |
|---|---|
| Automated code gate | GO |
| Capped beta | GO |
| Public paid | GO |

## Required gates

| Suite | Command | Status |
|---|---|---|
| lint | `npm run lint` | ci_pass |
| typecheck | `npm run typecheck` | ci_pass |
| unit-contract-safety | `npx vitest run` | ci_pass |
| eval-gate | `npm run eval` | ci_pass |
| production-build | `npm run build` | ci_pass |
| e2e-public | `npm run test:e2e:public` | ci_pass |
| e2e-authenticated | `npm run test:e2e:matrix` | ci_pass |
| release-check | `npm run release-check` | ci_pass |

## Open blockers

_None open._

## Owner-run evidence

| Id | Status | Action |
|---|---|---|
| migrations-050-054-applied | live_rehearsed | Confirm production migrations 050-054 are applied and verified via the exact schema/index/RPC probes in scripts/verify-migrations-050-054.sql and /api/health/ready (paid mode). |
| billing-reconcile-fresh | live_rehearsed | Fire billing-reconcile once with the isUnknownActivePrice fix deployed so cron_billing_reconcile_freshness=ok in paid readiness. |
| authenticated-e2e-matrix | ci_pass | Run the full authenticated E2E matrix once, unattended, against a throwaway non-production Supabase with 050-054 applied, pinned at the frozen v22 candidate SHA. |
| secret-rotation | live_rehearsed | Rotate the previously-reported-exposed credentials (database credentials, disposable keys, CRON_SECRET, ADMIN_STATS_SECRET) and redeploy dependent services, per docs/runbooks/key-rotation-and-backup.md. Record rotation metadata only. |
| live-transaction | live_rehearsed | One real low-value transaction end to end on live Stripe: charge, cancel, reactivate, payment recovery, refund, per docs/runbooks/live-transaction-rehearsal.md. |

## Rollback

The v22 product-code changes are src/app/api/ai/regenerate-section/route.ts (free-sample claim/refund correctness) and src/lib/stripe/reconcile.ts (isUnknownActivePrice scoping — no entitlement/money logic changed), each reverted by restoring the previous file; no migration added; no other Stripe code changed (frozen at v16). All 050-054 migrations are additive and reversible with a data-safe rollback recorded in each file. Code rollback target is the last promoted RC.

