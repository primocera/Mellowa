# Mellowa v12 — authoritative candidate status (MW-V12-09)

**Candidate:** `745b4a45304c2a8b0eaa61fa6995b989ab60b12a` · **Lifecycle:** frozen ·
**Reconciled:** 2026-07-31. Machine-readable source of truth:
[`docs/release/manifest.v11.json`](../manifest.v11.json), validated by
`tests/release-manifest.test.ts`. This document is a human summary; where it and
the manifest differ, the manifest is right.

## Verdicts

| Tier | Verdict |
| --- | --- |
| Automated code gate | **CONDITIONAL GO** |
| Capped private beta (≤50) | **CONDITIONAL GO** |
| Unrestricted public paid | **CONDITIONAL GO** |

`GO` requires zero open required P0/P1 with candidate-pinned or live evidence.
Four required blockers remain open under the owner's standing accepted risks, so
the strongest honest verdict is CONDITIONAL GO. `NO-GO` is one deleted
acceptance away, and the test proves it.

## Gates re-run at `745b4a4` (no production secrets needed)

| Gate | Result |
|---|---|
| lint | 0 errors, 8 pre-existing warnings |
| typecheck | clean |
| unit / contract / safety | **1234 passed** |
| eval | **81 passed** |
| production build | ✓ |
| public E2E (desktop/375/320) | **75 passed** |
| perf (warm lab) | LCP 828/656/676 ms, CLS 0; INP not measured (labelled proxy 12 ms) |

Raw artifacts: `docs/release/evidence/v12/rc/`.

## Blocked / owner-run — required before public paid launch

1. ~~**Apply migrations 040 and 041** to live Supabase~~ — **DONE 2026-08-01**
   (reminder unsubscribe marker; web_vitals). App tolerated absence (failed
   closed) before; both now applied to the live project.
2. **Live EUR transaction** (`P0-LIVE-TRANSACTION`) — **OPEN, accepted risk
   (Primoz Cerar, 2026-08-01). An accepted risk is not closed** — the blocker
   stays in `blockers` and is revisited before the paid cohort scales.
   Real-money lifecycle verified **live** against the live
   9.99 EUR plan, confirmed on the Stripe dashboard:
   - Charge: €9.99 EUR Succeeded (Aug 1 1:03 PM); `customer.subscription.created` → 200; Premium granted; renews 2026-09-01. No duplicate charge.
   - Cancel: `cancel_at_period_end`; access retained to 2026-09-01; `customer.subscription.updated` → 200 (1:28 PM); one cancellation email, no dupes.
   - Unsubscribe: optional reminder suppressed (040 marker); billing/account mail still arrives; no duplicate mail.
   - Reactivate: active again, **no second charge** (single €9.99 confirmed); no unexpected mail.
   - **Refund: performed live, `charge.refunded` webhook → 200.**
   The only leg **not** live-witnessed is a payment **failure→recovery** (step 5)
   and the **late-failure-after-recovery** ordering (step 6): a live card can't be
   forced to decline on demand, and forcing it needs a test clock against a
   non-prod Supabase the owner doesn't have. That path is order-resilient in code
   (`event-order.ts`) and proven by two tests — the pure guard + route model
   (`tests/billing-lifecycle-order.test.ts`) and a **real-handler runtime test**
   (`tests/webhook-order-integration.test.ts`, invokes `POST` with transport
   mocked). Runtime tests are **not** live owner evidence, so this residual is
   carried as the **P0-LIVE-TRANSACTION accepted risk** (Primoz Cerar,
   2026-08-01); the live/test-clock witness is deferred to uncap-day per
   `docs/runbooks/billing-order-test-clock.md`. Owner evidence line reads
   `blocked` (4/5 items live_rehearsed, the 5th blocked on a test clock).
3. **Reminder rehearsal** (`P1-REMINDER-REHEARSAL`): a duplicate eligible cron
   run (dedupe key holds) and a forced provider failure (retry/backoff →
   dead-letter), per `docs/ops-cron.md`.
4. **Key rotation + isolated restore** (`P1-ROTATION-RESTORE`) with a measured
   RTO, per `docs/runbooks/key-rotation-and-backup.md` +
   `docs/runbooks/restore-verification.sql`.
5. **Full authenticated matrix** (`P1-AUTH-E2E-AT-HEAD`): `RC_GATE=1 npm run
   test:e2e:matrix` against a seeded non-production Supabase, per
   `docs/release/v12/MW-V12-02-owner-commands.md`.
6. **Production release-check** (`npm run release-check` with prod env pulled)
   and **live EUR price verify** (`npm run verify-prices`).
7. **Cold-start** (`PERF_MODE=cold` against a preview) and **field vitals** p75
   once ≥100 samples exist (`P2-COLD-START`, `P2-INP-UNMEASURED`).

Claude Code runs none of the above; they move real money, real secrets or need a
seeded/production environment.

## What v12 changed (reduced risk, did not close owner evidence)

- Release truth reconciled; candidate lifecycle + drift validation (MW-V12-01).
- Authenticated matrix, fail-closed runner, integrity gate, marker-guarded seed
  (MW-V12-02).
- Order-resilient billing — the late-failure-after-recovery money bug is fixed
  and unit-tested; foreign-product isolation (MW-V12-03).
- Reminder dedupe proven; provider failure paths; **`P2-REMINDER-OPTOUT-SURFACE`
  closed** (MW-V12-04).
- Per-secret rotation, safe fingerprints, executable restore checks (MW-V12-05).
- Premium recurring-value paywall (MW-V12-06).
- Anonymous field Web Vitals + cold-start labeling + honest budgets (MW-V12-07).
- Beta-scorecard data freshness (MW-V12-08).

## Rollback triggers

Flag-based and data-safe: `FLAG_MONTHLY_FAIR_USE=0`, `FLAG_PLAN_REPAIR=0`,
`FLAG_WEEKLY_REFLECTION=0`, `FLAG_TRIAL_LENGTH_EXPERIMENT=0` (pinned trials
complete as disclosed), plus Vercel deploy promote-previous. Every migration is
additive; 040/041 are an added column and an anonymous table, both tolerated if
absent — no migration reversal is ever required.

## Not proven

No live money has moved through the paid lifecycle; recovery time is unmeasured;
the authenticated matrix has not run unattended; cold-start and field p75 are
uncollected. The verdict is CONDITIONAL, not GO, precisely because of these.
