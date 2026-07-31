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

1. **Apply migrations 040 and 041** to live Supabase (reminder unsubscribe
   marker; web_vitals). The app tolerates their absence (fails closed).
2. **Live EUR transaction** (`P0-LIVE-TRANSACTION`): charge → cancel → reactivate
   → payment recovery → **late failure after recovery** → refund, per
   `docs/runbooks/live-transaction-rehearsal.md`.
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
