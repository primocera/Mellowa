# Launch rehearsal & go/no-go scorecard — Prompt Pack v9 (MW-V9-00 … MW-V9-12)

**Release candidate:** branch `v9`, the MW-V9-12 gate commit (this document is
its final change; the commit that carries it is the frozen RC). All automated
gates below were verified green at `96811b6` — the tip immediately before this
document — and re-running them on the RC commit changes only this file, which is
docs-only. Supersedes `launch-go-no-go-v8.md`; the v8 document stays as history.

**Scope:** records what the automated suite proves in this environment and,
honestly, what only a human operator can verify in production. Per the delivery
rule, **nothing here claims production behaviour was verified from tests or
mocks.** Status vocabulary is exact: *tested* (automated in-repo), *configured*
(infrastructure set, not exercised), *rehearsed live* (a human ran it against
prod), *observed* (seen in real production traffic).

---

## 1. Automated gates — tested in-repo at the RC

| Gate | Command | Status |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 errors (8 pre-existing warnings in untouched files) |
| Type safety | `npm run typecheck` | ✅ clean |
| Unit/contract/safety suite | `npx vitest run` | ✅ **604 passed / 73 files** |
| Adversarial red-team matrix | `npx vitest run tests/adversarial-matrix.test.ts` | ✅ 13 passed (obfuscation, injection, fail-closed) |
| Safety + eval gate | `npm run eval` | ✅ (runs within the suite) |
| Production build | `npm run build` | ✅ clean |
| Go/no-go gate self-check | `npx vitest run tests/go-no-go-gate.test.ts` | ✅ this doc holds to the GO-blank gate |
| Public browser journeys | `npm run test:e2e:public` | ⚠ run on demand (Playwright) — desktop + mobile |
| Authenticated browser journeys | `npm run test:e2e` | ⚠ **skipped — needs a seeded test user env** (P1) |
| Env/readiness presence | `npm run release-check` | ⚠ run with prod env pulled |

## 2. What v9 added on top of v8 (all tested in-repo)

- **MW-V9-01** Now-first IA: four destinations (Today/Week/Saved/You), Patterns under You, `primary_nav_viewed`.
- **MW-V9-02** One-minute check-in with an always-visible pre-generation summary, `checkin_started`.
- **MW-V9-03** Versioned Now ruleset (`NOW_SELECTOR_VERSION`) + short post-Done Undo on the Now card.
- **MW-V9-04** Repair trust: server-derived deterministic diff, exact scope preview, version-checked Undo (migration `034`, 409 on conflict), honest cost outcomes.
- **MW-V9-05** Personalization center completed: Weekly carry-forward group (one canonical view), "Reset learned preferences" with exact scope + precise undo.
- **MW-V9-06** Live per-favourite allergen revalidation badges; safe one-tap pantry chips.
- **MW-V9-07** Week as one loop (This week / Carry forward / Next week); recap removed from Today (quiet link); review-before-generate.
- **MW-V9-08** Sharpened landing wedge + four-beat mechanism + three Premium jobs; opt-in `FLAG_EMPHASIZE_YEARLY` (default off, Monthly-first).
- **MW-V9-09** Real binary PWA icons (192/512 + maskable + Apple touch) from the brand mark; shared UI primitives; app error boundary + loading skeletons.
- **MW-V9-10** Monthly fair-use cap (migration `035`, `FLAG_MONTHLY_FAIR_USE`, generous default 300, atomic, honest denial); admin cost scorecard (p50/p90, high-use, cost); billing-state entitlement matrix pinned.
- **MW-V9-11** Full beta value-loop funnel on the admin dashboard; `docs/beta-research.md` (interview scripts, weekly memo, stop criteria).

## 3. State-by-state trace (tested via unit/contract fixtures)

Anonymous, sample (one plan + one bounded non-meal adjustment, no card),
trial-eligible, active, trial-used, past_due, canceled, unsafe/crisis (blocked,
no generation, no entitlement spend, no upsell), severe allergy (fail-closed
omit + review, never substitute), invalid timezone (repair path, stale plan
never shown as Now), provider failure (prior plan untouched, honest cost),
deletion (registry anonymize/cascade). Each is covered by contract tests; **none
is a substitute for the authenticated browser + live rehearsal below.**

## 4. Live rehearsal — operator must execute (evidence required)

None of these can be proven from this environment. See
`docs/runbooks/live-transaction-rehearsal.md` for the step-by-step.

- [x] **Apply migrations 027–033 to live Supabase** — applied by the operator on
      2026-07-21 before the v8 merge (`f659909`).
- [ ] **Apply v9 migrations `034` (repair-undo version check) and `035`
      (monthly fair-use overload) to live Supabase** — owner-run before the v9
      deploy. Evidence: __
- [x] **Live Stripe configuration** switched 2026-07-21 (live key, webhook +
      signing secret, two live EUR price IDs). Configuration only.
- [ ] **One real low-value transaction** end to end: signup → sample → sample
      adjustment → live trial checkout → exact charge disclosure → daily repair
      + Undo → cancel → reactivate → billing portal → refund. Evidence: __
- [ ] **Reminder / cron / email** live rehearsal: opt-in preview, quiet hours,
      pause/skip, idempotent send, no sensitive content, dead-letter check.
      Evidence: __
- [ ] **Authenticated seeded E2E** (`npm run test:e2e` with `seed:test-user`)
      run against staging. Evidence: __
- [ ] **Key-rotation drill + backup/rollback rehearsal**. Evidence: __

## 5. P0 / P1 / P2

| # | Level | Item | Owner | Acceptance |
|---|---|---|---|---|
| 1 | **P0** | Live transaction rehearsal (charge→cancel→reactivate→refund) unrun | Owner | Recorded evidence in §4 |
| 2 | **P0** | v9 migrations `034`/`035` applied to live Supabase | Owner | `/api/health/ready` + row check |
| 3 | **P1** | Authenticated seeded E2E not run in this env | Owner/CI | Green run recorded |
| 4 | **P1** | Reminder/cron/email live rehearsal | Owner | Evidence in §4 |
| 5 | **P2** | Ceiling-denial counting not instrumented (scorecard shows 0) | Eng | Denial logging or accept |
| 6 | **P2** | Public Lighthouse/perf pass (no CI perf gate by project rule) | Owner | Manual run before launch |

## 6. Rollback triggers

Any of: unsafe or allergen-miss output reaching a user; duplicate charge or
duplicate generation; repair corruption; privacy leak (incl. sensitive data in
analytics/email); reminder complaint spike or dead-letter growth. Rollback paths
are flag-based and data-safe: `FLAG_MONTHLY_FAIR_USE=0`, `FLAG_PLAN_REPAIR=0`,
`FLAG_WEEKLY_REFLECTION=0`, `FLAG_EMPHASIZE_YEARLY` unset, and per-surface UI
reverts. No migration reversal is required to roll back any v9 behaviour.

## 7. Verdict

- **Automated code gate:** ✅ GO — lint/typecheck/604 tests/build all green at the RC.
- **Capped private beta (≤50 invites, no card for the sample):** ✅ **CONDITIONAL GO**
  — permitted once v9 migrations `034`/`035` are applied to live Supabase (P0 #2);
  all beta surfaces are flag-guarded and data-safe.
- **Public paid launch: NO-GO** — the live transaction rehearsal (P0 #1) is open
  and is owner-run, not Claude-run. This is honest and expected: a code-complete
  RC is not a proven paid product. No public surface overstates safety,
  monitoring, medical scope, trial eligibility or Premium continuity.

Signed (code gate, automated evidence only): Claude Code — RC verified at `96811b6`.
Public-paid sign-off remains with the owner after §4 evidence is recorded.
