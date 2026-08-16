# FINAL-01 — Final v19 launch certification (Mellowa)

**Branch:** `v19` · **HEAD:** `0fa14ca` (product code merged onto the full v18 line)
**Rule:** product quality is never averaged with missing release evidence. Owner
gates block their tier regardless of test count.

## Automated code gate (re-run at HEAD)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **pass** |
| Unit / contract / safety | `npx vitest run` | **169 files / 2026 tests / 0 fail / 0 skip** |
| Dependency audit | `npm audit --omit=dev` | **0 vulnerabilities** |
| Lint | `npm run lint` | **pass** (exit 0) |

Owner-run at the immutable candidate (not folded into this gate): `eval`,
production `build`, public E2E, authenticated matrix, `release-check`.

## Three verdicts

### Product capability — STRONG
All v19 prompts landed with tests: canonical one-plan-per-local-day (MW-02),
timezone-correct weekly reflection (MW-03), one canonical preference model
(MW-07), deep readiness over migrations 044–049 + worker freshness (MW-04),
machine-readable cron registry (MW-05), repair-metric contradiction resolved
(MW-10), lifecycle catalog wired (MW-12), first-session funnel live (MW-08),
pricing-discovery + dark-pattern CI + experiments-off-by-default (MW-09),
support burden honest-or-unavailable (MW-11), SLO/budget scale-readiness (MW-13),
premium content contract (MW-14), complete-object-graph Stripe isolation guard
(XAPP-01), security/privacy/a11y/resilience sweep (XAPP-02).

### Capped beta — CONDITIONAL GO
Code is ready. **Blockers (owner):**
1. Apply migrations `044`–`049` to production (preflight/verify in each file; `049`
   additive, non-destructive).
2. Cut the immutable RC at the v19 HEAD (`release-candidate.yml`) and re-observe
   the authenticated matrix at that SHA — the v16 closure at `e40737b` is
   superseded by v19 product drift (MW-01). `P1-AUTH-E2E-AT-HEAD` is **re-opened**
   at the new SHA until observed.
3. Observe `/api/health` + `/api/health/ready` on the deployed candidate (MW-04);
   for paid, `READINESS_MODE=paid` fails closed on a degraded critical worker.

### Public paid — NO-GO
Adds, on top of the capped-beta blockers:
1. **Live-money rehearsal** — the full charge→cancel→reactivate→recovery→refund
   sequence witnessed on the current code/price (`P0-LIVE-TRANSACTION`). Owner has
   **accepted this risk** for a bounded launch (carried forward from v16); re-verify
   with one completed current-code live charge before scaling volume.
2. A **mature 4-week bounded-cohort window** meeting the predeclared hypotheses
   (D2/D3/Week/carry-forward/trial→charge/renewal/refund) — none exist yet; pricing
   discovery and scale readiness are correctly `unavailable`/blocked.

## Monitoring

- First 24h: `/api/health` (5-min), `/api/health/ready` (bearer), Stripe webhook
  dead-letters, email outbox backlog, deletion worker freshness.
- First 14/28 days: the weekly operator decision (XAPP-03) with exact
  numerators/denominators; expand stays BLOCKED until a mature window clears.

## Rollback

Flag-based and data-safe (`FLAG_PLAN_REPAIR=0`, `FLAG_WEEKLY_REFLECTION=0`,
`FLAG_TRIAL_LENGTH_EXPERIMENT=0`, beta intake switch). Every migration additive/
re-runnable. Code rollback target for the shipped line remains the last certified
candidate until a v19 RC is frozen.

## Single next action

**Owner:** merge `v19` → `main`, apply migrations `044`–`049`, and cut the immutable
RC — then re-observe the authenticated matrix at that SHA. Everything else waits on
that candidate.

## What may launch now

Nothing new is auto-launched by this pack. Capped beta may proceed **once the owner
completes the three capped-beta blockers**. Public paid **waits** on live-money
evidence and a mature value window. One active release truth remains per repo;
superseded v-docs stay marked superseded.
