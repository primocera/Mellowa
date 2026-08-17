# v20 — Final Mellowa launch & scale certification (MW-FINAL)

> Independent per-tier verdicts from **exact-SHA evidence only**. A block in one
> tier is never averaged away by product quality. No tier says "GO" while a
> required owner gate is `not_run`. The machine-readable authority is
> `docs/release/manifest.v20.json` (draft, all tiers **UNASSESSED**); this page
> must not contradict it.

## Evidence at this SHA
- **Automated (code) evidence, local:** typecheck, lint, production build clean;
  `vitest 2144/2144`; `eval 81/81`. This is real but **local, not a frozen RC** —
  ordinary CI cannot promote the manifest.
- **Owner evidence:** migrations 050–054 applied to production — **NOT RUN**;
  immutable RC cut — **NOT RUN**; authenticated E2E matrix at a v20 SHA — **NOT
  RUN**; live billing/email/reminder/outbox/cron/deletion rehearsals — **NOT RUN**;
  verified support ingestion — **NOT RUN**; mature 4-week cohort — **not present**.
- **Cross-app:** shared-Stripe isolation re-proven at the v20 SHA (XAPP-01).

## Per-tier verdict matrix

| Tier | Verdict | Evidence satisfied | Blocker | Owner action |
|---|---|---|---|---|
| **Product capability** | **STRONG** | Adaptive-day loop, completion integrity (MW-01), atomic generation (MW-02), fail-closed timezone/readiness/cron/scale/support (MW-03–07), safety posture intact | — (capability is not a launch verdict) | none |
| **Automated code gate** | **CONDITIONAL — pass local, not frozen** | typecheck/lint/build/2144 tests/eval green locally | P0-V20-RC-NOT-CUT (no immutable RC) | Cut the RC via `release-candidate.yml`; promote-candidate |
| **Capped beta (≤ invited cap)** | **BLOCKED ON OWNER** | MW-01/MW-02 risk-register items satisfied in code; migration plan ready | P0-V20-MIGRATIONS-APPLIED, P1-V20-AUTH-E2E-AT-HEAD | Apply 050–054; run auth matrix at the candidate SHA (disposable Supabase, Stripe TEST) |
| **Bounded public paid** | **BLOCKED ON OWNER** | order-resilient billing + isolation contracts green | Above + paid readiness observed + P0-LIVE-TRANSACTION (accepted risk carried from v16) | Apply migrations; confirm `/api/health/ready` paid=200; run the live billing rehearsal (MW-09 validator) |
| **Unrestricted paid** | **NO-GO** | — | All of the above + fair-use at volume | Do not open; requires bounded-paid observation first |
| **Acquisition expansion** | **BLOCKED (scaleDecision = HOLD)** | canonical scaleDecision composed (MW-06) | Immature cohort + owner gates unattached (`releaseGatesPassed=false`); pricing discovery closed (support ingestion NOT RUN) | Load a mature 4-week cohort with exact denominators; verify support ingestion; then re-read scaleDecision |

**Why no higher verdict:** every paid/scale tier depends on at least one owner gate
that is `not_run` at this SHA. Product quality is high, but a block in a tier is
not averaged away — the tiers above stay CONDITIONAL/BLOCKED until the exact owner
evidence is attached at the exact candidate SHA.

## Non-negotiables honored
- No bare GO while any required owner gate is `not_run`.
- No production evidence inferred from mocks, tests, docs or ordinary CI.
- No medical/adherence claim introduced.
- The final status matches the machine-readable manifest (UNASSESSED).

## Ordered owner checklist (next single action first)
1. **Apply migrations 050–054** to production per `docs/release/v20/MIGRATION_PLAN.md`
   (preflight → apply → verify → rollback), disposable Supabase first. *(rollback:
   per-migration footer)*
2. **Confirm paid readiness** `/api/health/ready` (READINESS_MODE=paid) = 200 —
   the 052 exact-schema probe, MW-04 config and MW-05 ledger freshness all pass.
3. **Cut the immutable RC** (`release-candidate.yml`) at the deployed SHA; it runs
   the authenticated seeded matrix. *(stop: any missing secret / zero tests fails
   the candidate)*
4. **Promote** the candidate (`promote-candidate.mjs`) — attaches frozen evidence;
   only then may a tier verdict move off UNASSESSED.
5. **Run the live rehearsals** (`docs/runbooks/v20-rehearsals.md`) for the tier
   being opened; validate each artifact with `validateRehearsalEvidence`. *(stop:
   any duplicate charge/email, early reminder, entitlement mismatch, partial
   deletion false-success)*
6. **For scale only:** load a mature 4-week cohort + verified support ingestion,
   then re-read `report.scaleDecision`. Expansion is a small **manual** increment.

**Next single action:** step 1 — apply 050–054 to a disposable Supabase and verify.

## Cross-app
See `docs/release/v20/XAPP-FINAL-launch-plan.md`. Mellowa and Scalvya keep separate
candidates, migrations, receipts, live-money evidence and cohorts; a GO in one
cannot close a blocker in the other; both public-paid launches never open at once.
