# Launch go/no-go scorecard — v11 (FROZEN)

**Status: FROZEN (MW-V11-08).** This is the release-candidate verdict for v11.
Every line is either a measured result, an explicitly unrun check, or an owner
action with an owner and an acceptance test. Nothing here is a plan.

**RC SHA:** `0025a5021f921800d08edee1c86f3c33c62185da` — the last functional
commit. MW-V11-08 adds no product code: only this freeze and the manifest
update, because freezing the gate's own commit would mean the verdict described
code the gate had not run against. Any later commit creates a new candidate and
requires the affected evidence to be re-run.

**Machine-readable source:** [`docs/release/manifest.v11.json`](release/manifest.v11.json).
This document is checked against that manifest by `tests/release-manifest.test.ts`.
Where the two disagree the build fails, so they cannot drift apart the way the
v10 documents did.

**Branch:** `v11`. **Baseline:** `169c706683a821054351f45a5916f667ea93557c`
(= `main` at the start of v11; confirmed as the actual HEAD, no drift).

Supersedes [`launch-go-no-go-v10.md`](launch-go-no-go-v10.md), which stays as
history and must not be edited to match this document.

**Status vocabulary is exact and load-bearing.** The manifest uses the machine
forms; this document uses the words. *not run* · *blocked* (a precondition is
missing) · *skipped* · *failed* · *local pass* · *CI pass* · *preview pass* (a
deployed preview on real infrastructure) · *live rehearsed* (a human ran it
against production) · *observed* (seen in real production traffic). Nothing
below claims production behaviour was verified from tests or mocks, and an
unknown is never a pass.

---

## 1. What v11 repaired first

The v10 record contradicted itself in three places, and each contradiction let a
reader reach a more comfortable conclusion than the evidence supported:

1. **`BUILD_STATE.md` called the authenticated state matrix both "RUN AND IS
   GREEN" and "written but unrun"** — in the same file, eleven lines apart.
2. **`launch-go-no-go-v10.md` listed `npm run test:e2e:journey` as "not run — no
   seeded env" one row above a row reporting the same command green**, and
   closed authenticated E2E in §3 while §6 still named it an open P1.
3. **It said "four owner-run items" and then listed three.**

None of these was a lie about the work. They were a document set with no single
owner of truth, edited by different slices at different times. The repair is
structural rather than editorial: one manifest, one validator, and a test that
fails the build when the prose stops matching it.

**The substantive finding.** The v10 authenticated evidence is real, but it was
produced at a commit that is no longer the head. Three commits landed after it
(`e5bdd3e`, `4b23a51`, `169c706`), one of which rewrote the landing header. So
authenticated browser evidence is recorded here as **not run at this baseline**,
not as green. That is not a claim the earlier run was wrong; it is a refusal to
let a result from one commit certify another. MW-V11-04 owns the rerun.

## 2. Automated gates — measured at the baseline

Every row was run at `169c706` and the raw output is committed alongside it.

| Gate | Command | Status | Evidence |
|---|---|---|---|
| Lint | `npm run lint` | ✅ local pass — 0 errors, 8 pre-existing warnings | [`lint.txt`](release/evidence/v11/lint.txt) |
| Type safety | `npm run typecheck` | ✅ local pass | [`typecheck.txt`](release/evidence/v11/typecheck.txt) |
| Unit / contract / safety | `npx vitest run` | ✅ local pass — **1029 passed / 86 files** (900 at the baseline) | [`vitest.txt`](release/evidence/v11/vitest.txt) |
| Safety + eval gate | `npm run eval` | ✅ local pass — **81 passed** | [`eval.txt`](release/evidence/v11/eval.txt) |
| Production build | `npm run build` | ✅ local pass | [`build.txt`](release/evidence/v11/build.txt) |
| Public browser journeys | `npm run test:e2e:public` | ✅ local pass — **75 passed** across desktop / 375px / 320px (51 at the baseline, plus the v11 copy, header and landing-proof assertions) | [`e2e-public-mw-v11-03.txt`](release/evidence/v11/e2e-public-mw-v11-03.txt) |
| Authenticated browser journeys | `npx playwright test e2e/journeys.spec.ts` | ⚠ **partial — 6 passed, 6 skipped.** Login, settings data controls and pricing trial state now genuinely execute against live Supabase across desktop / 375px / 320px. The rest need fixtures that must be seeded first | [`e2e-auth-mw-v11-04.txt`](release/evidence/v11/e2e-auth-mw-v11-04.txt) |
| Daily-journey state matrix | `npm run test:e2e:journey` | ⛔ **blocked** — needs the service-role seed to be run once per state | — |
| Env / readiness presence | `npm run release-check` | ⚠ **blocked** — fails closed without production env pulled, by design | — |
| Core Web Vitals | `npm run perf` | ✅ local pass — landing LCP **812ms**, CLS **0** (budgets 2500ms / 0.1). **INP not measured** | [`perf/vitals.json`](release/evidence/v11/perf/vitals.json) |
| Optional live provider eval | `scripts/eval-live.mjs` | ⏭ **skipped by design** — opt-in, advisory, cannot gate a release | — |

**Header note.** At the baseline, `e2e/public.spec.ts` exempted every control
inside `<header>` from the 44px target rule, so those controls were *untested*
rather than *compliant*. MW-V11-02 removed the exemption; the row above reflects
the post-fix run.

**`npm run test:e2e` exits 0 even when every authenticated test skips.** That is
the whole reason this document does not read a verdict off an exit code, and why
CI has a separate `RC_GATE` check that turns an unrun authenticated suite into a
hard error. A green tick from a command that ran nothing is the most expensive
kind of evidence.

**Two reasons those suites had never run, both found in MW-V11-04:**

1. **Playwright never loaded `.env.local`.** Next.js loads it and the seed
   script has its own loader, but the test runner had neither — so setting the
   `E2E_*` variables in the obvious place configured nothing and the suites
   skipped while looking correctly configured. Fixed in `playwright.config.ts`.
2. **Two required journeys were unreachable by any fixture.** Every seed state
   wrote a `subscriptions` row, so a trial-eligible user and a prior-trial user
   could not be produced, and the two tests needing them skipped on every run
   since they were written. `--state=trial-eligible` and `--state=trial-used`
   now exist.

## 3. Owner-run evidence

None of this can be produced from a development environment. Claude Code must
not mutate live Stripe, Supabase, Vercel, Resend, DNS or cron.

**An unticked box means "no evidence is recorded here", not "the owner has not
done it."** The owner has run live operational work throughout v7–v10 — cron
scheduling, migrations ahead of every release, manual testing — and that work is
only partly captured. Ask the owner before treating an empty line as an open
task.

Recorded as done (so it stops being re-asked):

- [x] **Vercel + cron-job.org schedules configured and exercised** — owner, v7,
      including `CRON_SECRET` bearer headers on every scheduled route.
      *Caveat: this predates the MW-V10-05 consent gate and the `past_due` /
      safety suppression rules, so the v10 behaviour still needs its own
      rehearsal — that is `P1-REMINDER-REHEARSAL`, and it is narrower
      than "set up the crons".*
- [x] **Migrations applied to live Supabase ahead of each release** — owner,
      through v9; `034`/`035` on 2026-07-23; `036`–`039` verified present by a
      read-only check on 2026-07-26. Confirm via `/api/health/ready`.
- [x] **Manual functional testing across versions** — owner, ongoing.
- [x] **Live Stripe configuration** switched 2026-07-21 (live key, webhook and
      signing secret, two live price ids). **The price ids were recorded here as
      EUR and they are not — both are USD.** See `P0-PRICE-CURRENCY`; this line
      is left uncorrected above the correction on purpose, because "configured"
      was asserted from the fact that ids existed rather than from reading them.
      **Configured only** — no
      transaction has been put through it.

Open, with an owner:

- [x] ~~**Fix the price currency before any other billing step.**~~ **Closed
      2026-07-28.** New EUR prices created and repointed in Vercel production;
      `verify-stripe-prices.mjs` run in LIVE mode against the pulled production
      env reads back 999 eur / month and 5999 eur / year, exit 0.
      (`P0-PRICE-CURRENCY`)
      Evidence: [`rc/verify-prices.txt`](release/evidence/v11/rc/verify-prices.txt)

- [ ] **One real low-value transaction** end to end: signup → sample → sample
      adjustment → live trial checkout → exact charge disclosure → daily repair
      and Undo → cancel → reactivate → billing portal → refund.
      Runbook: [`live-transaction-rehearsal.md`](runbooks/live-transaction-rehearsal.md)
      — 16 steps with expected *and* observed columns, six abort conditions,
      alert thresholds, cleanup and rollback.
      (`P0-LIVE-TRANSACTION`) Evidence: __
- [ ] **Reminder / cron / email rehearsal** of the v10 behaviour, including the
      native one-click unsubscribe path and a deliberate provider break.
      Worksheet at the end of [`ops-cron.md`](ops-cron.md).
      (`P1-REMINDER-REHEARSAL`) Evidence: __

      *Closed by data on 2026-07-26:* a read-only check of `wellbeing_profiles`
      found **0 accounts with `reminders_opt_in` set**, so the fail-closed
      consent gate takes nothing away from anyone and no grandfathering
      migration is needed. Re-check if reminders are enabled for real users
      before the gate is exercised.
- [ ] **Key rotation drill + isolated backup restore**, recording measured
      wall-clock recovery time. Procedure in
      [`key-rotation-and-backup.md`](runbooks/key-rotation-and-backup.md) —
      now with a restore-verification table (counts, ownership, consent,
      allergy fields, Stripe mapping, deletion tombstones), tested-versus-desired
      RTO/RPO, and what a restore does *not* bring back.
      (`P1-ROTATION-RESTORE`) Evidence: __

**Capped beta.** Predeclared thresholds for the repeat-value question live in
[`beta-scorecard.md`](beta-scorecard.md): day-2/day-3 return, Adjust
preview→apply, Week open and carry-forward, trial→charge, renewal, refund and
support cost — each with its numerator, denominator, window and the action to
take if it lands short. Cohorts under five report "—" rather than 0%, and the
expansion verdict defaults to BLOCKED.

That is **3 owner-run items**. The count is derived from the manifest and
asserted by a test, so it can no longer disagree with the list beneath it.

`P1-ROTATION-RESTORE` carries a recorded **accepted risk** for `public_paid`
(Primoz Cerar, 2026-07-28). An acceptance does not close it: the blocker stays
open above, its owner evidence still reads `not_run`, and the tier it covers can
reach `CONDITIONAL GO` but never `GO`. Deleting the acceptance returns the
verdict to NO-GO on its own — asserted in `tests/release-manifest.test.ts`.

## 4. Open blockers

Ids are canonical and come from the manifest. A blocker blocking a tier makes a
GO verdict for that tier impossible — enforced by the validator, not by
convention.

| Id | Level | Blocks | Item | Owner |
|---|---|---|---|---|
| `P0-PRICE-CURRENCY` | **P0** | capped beta + public paid | Live Stripe prices are USD while every surface promises EUR; Stripe does not convert | Owner |
| `P0-LIVE-TRANSACTION` | **P0** | public paid | No real transaction has been put through live Stripe end to end | Owner |
| `P1-REMINDER-REHEARSAL` | **P1** | public paid | Reminder / cron / lifecycle email delivery never observed in a real inbox | Owner |
| `P1-ROTATION-RESTORE` | **P1** | public paid | Key rotation and backup restore never rehearsed | Owner |
| `P1-AUTH-E2E-AT-HEAD` | **P1** | public paid | Authenticated browser journeys not run at this baseline. MW-V11-04 hardened them and fixed a silently-skipping test, but running them needs a seeded environment this session does not have | Eng + Owner (env) |
| `P2-DENIAL-COUNTING` | P2 | — | Fair-use ceiling denials uninstrumented, so the scorecard shows zero by construction | Eng |
| `P2-COLD-START` | P2 | — | Cold-route LCP measured 4080ms versus 812ms warm; unmeasured against the real deployment | Eng |
| `P2-INP-UNMEASURED` | P2 | — | INP has never been measured; the perf suite's probe is a labelled proxy, not INP | Eng |
| `P2-BRAND-TYPEFACE` | P2 | — | The product renders in Arial, not Geist. The webfonts were loaded but never applied; the unused download is now removed | Owner |
| `P2-SUITE-FLAKES` | P2 | — | Two suites failed once each under load during v11 and passed on re-run; neither reproduced. Not to be closed with a retry | Eng |
| `P2-REMINDER-OPTOUT-SURFACE` | P2 | — | Settings does not reflect "off because you unsubscribed" | Eng |

**Closed during v11**

| Id | Closed by | What proves it |
|---|---|---|
| `P1-COMMERCIAL-COPY` | MW-V11-01 | The hero rendered its promise glued to the next sentence with no space, and the canonical helpers produced a plural noun form where the sentence needed the adjective form ("a 3-day trial"). Both are fixed at the helper level and asserted **on the rendered page**, not only in the source: `tests/commercial-copy.test.ts` plus rendered-text assertions in the browser suite. |
| — | MW-V11-03 | Not a blocker, recorded for honesty: the landing now *shows* the adaptation loop rather than claiming it, and visible copy went from **753 to 677 words (−10.1%)** against a 15–20% target. The shortfall is deliberate. Removing the "every plan covers…" category list would have reached the target, and it was briefly removed — but that list is a pinned contract (`landing-conversion.test.ts`): enumerating what a plan actually produces is a completeness statement a buyer is entitled to. It was restored and the target missed instead. Excluding the newly added 210-word proof, pre-existing copy fell ~38%. |
| — | MW-V11-05 | **Performance was measured for the first time.** Landing LCP 812ms, pricing 600ms, signup 612ms (budget 2500ms); CLS 0 everywhere (budget 0.1). The fix that mattered: both webfonts were downloaded on every page and **rendered nowhere** — no component uses `font-sans`, and `body` sets Arial, which wins. Removing them cut the landing page from 246,924 to 192,732 transferred bytes (−22%) with no visual change, because nothing was using them. Two caveats that stay open: **INP is not measured** (the probe is a labelled proxy), and cold-start is excluded — a cold route measured 4080ms LCP versus 812ms warm. |
| `P1-HEADER` | MW-V11-02 | The exemption is gone and the header is held to the same 44px rule as every other public control. Every target is measured at 320, 360, 375, 768, 1024 and 1440 plus a 200% zoom case; the row is asserted not to wrap; the disclosure's expanded state, Escape handling, outside-click and focus return are asserted. 72 public browser journeys green. |

Closed in v10 and **not reopened here**: the trial-length experiment
infrastructure, the beta invite cap and stop switch, refund/dispute webhook
handling, and the `/api/health/ready` RPC-overload probe. Each is verified
present rather than rebuilt.

## 5. Rollback

Flag-based and data-safe: `FLAG_MONTHLY_FAIR_USE=0`, `FLAG_PLAN_REPAIR=0`,
`FLAG_WEEKLY_REFLECTION=0`, `FLAG_EMPHASIZE_YEARLY` unset,
`FLAG_TRIAL_LENGTH_EXPERIMENT=0` (pinned trials complete exactly as disclosed;
no subscription is touched), plus per-surface UI reverts. Every migration in the
repository is additive and re-runnable, so no migration reversal is required to
roll back any behaviour.

**Rollback triggers.** Any of: unsafe or allergen-miss output reaching a user;
duplicate charge or duplicate generation; repair corruption; a privacy leak
(including sensitive data in analytics, logs or email); a reminder complaint
spike or dead-letter growth; a reconcile report containing `adoptedSubscriptions`,
which means webhooks are being dropped and users are paying without access; any
trial charged on a date the user was not shown.

## 5b. Pinned contract versions at the RC

Anything below that changes makes this a different release candidate. Verified
against the code by `tests/rc-gate.test.ts`, not copied by hand.

| Contract | Pinned value |
|---|---|
| Daily-plan prompt | `daily-plan-v2@1` (sha256 in `src/prompts/versions.ts`) |
| Model | `AI_PROVIDER_MODEL`, default `claude-haiku-4-5-20251001`; per-route policy in `src/lib/ai/model-policy.ts` |
| Analytics taxonomy | analytics v1 — closed event enum, closed property keys |
| Migrations | `001`–`039`; v11 adds **none** |
| Reminder consent | `2026-07` |
| Trial variants | `control` = 3 days, `week_beta` = 7 days — experiment **inactive** |
| Opt-in flags (default OFF) | `FLAG_EMPHASIZE_YEARLY`, `FLAG_TRIAL_LENGTH_EXPERIMENT` |
| Fonts | none. Both webfonts were removed in MW-V11-05; the product renders in the platform stack |

**Migration rollback dry run.** v11 adds no migration. Every migration in the
repository was re-scanned for `drop table`, `drop column`, `truncate`, top-level
`delete from` and destructive type changes — none present, so a rollback is a
flag change or a code revert and never a migration reversal.

## 6. Verdict at the frozen candidate

Every command below was run at `0025a502`. Nothing here is inferred.

| Command | Result |
|---|---|
| `npm run lint` | ✅ 0 errors, 8 pre-existing warnings |
| `npm run typecheck` | ✅ clean |
| `npx vitest run` | ✅ **1076 passed / 87 files** |
| `npm run eval` | ✅ 81 passed |
| Safety suites (`safety`, `safety-matrix`, `adversarial-matrix`, `severe-allergy`, `output-guards`, `crisis-resources`) | ✅ 73 passed |
| Privacy suites (`privacy-registry`, `analytics-contract`, `consent`) | ✅ 26 passed |
| `npm run build` | ✅ clean |
| `npm run test:e2e:public` | ✅ 75 passed × desktop / 375px / 320px |
| `npx playwright test e2e/journeys.spec.ts` | ⚠ 6 passed / **6 skipped** |
| `npm run test:e2e:journey` | ⛔ **blocked** — needs the service-role seed |
| `npm run perf` | ✅ 4 passed — landing LCP 812ms, CLS 0 |
| `npm run release-check` | ⚠ **fails closed as designed** — 14 missing, no values printed. Owner must re-run with production env |
| `scripts/eval-live.mjs` | ⏭ skipped by design |
| `git diff --check` | ✅ clean |

### The two verdicts

- **Automated code gate: CONDITIONAL GO.** Everything runnable from this
  environment is green at the candidate. It is *conditional*, not GO, because
  the eight-state daily-journey matrix has not run at all and six authenticated
  journeys are skipped for want of a seeded fixture. A gate that has not
  executed is not a gate.

- **Capped private beta (≤50 invites, no card for the sample): CONDITIONAL GO.**
  The cap is a database trigger rather than a sentence in a document, the safety
  and allergen gates are fail-closed and tested, the sample needs no card, and
  `docs/beta-scorecard.md` now has thresholds predeclared before the data
  exists. The condition is the daily-journey matrix: before real people use the
  authenticated product daily, the eight states it covers should be green at
  this SHA. That is one seeded run away, not a code change.

- **Unrestricted public paid launch: NO-GO.**

  One P0 and four P1s are open. Three are owner-run and cannot be closed from
  any development environment — a real €9.99 transaction through to refund,
  reminder/cron/email delivery observed in a real inbox, and a key-rotation plus
  isolated-restore drill with a measured recovery time. The fourth is the
  authenticated matrix above.

  Under the standing rule that no GO may be marked with an open transaction,
  safety, allergen, privacy, billing or authenticated-E2E P0/P1, this verdict
  cannot be anything else.

### What this candidate changed, and why the rule keeps earning its place

v11 found seven defects, and **not one of them was visible to a green suite**:

1. The live hero rendered `you actually have.Tell Mellowa` with no space.
2. The canonical helpers produced "a 3 days trial" on three surfaces.
3. The 44px rule exempted every header control, so the header was untested
   rather than compliant.
4. Both webfonts loaded on every page and rendered nowhere — 53KB on the
   critical path for a typeface the product does not use.
5. A required E2E test located the trial CTA by its pre-rename wording, so it
   skipped for every user, forever, reporting nothing wrong.
6. Playwright never loaded `.env.local`, so configuring the authenticated suites
   in the obvious place configured nothing.
7. No seed fixture could produce a trial-eligible or prior-trial user, so two
   required journeys had never been able to run at all.

Defects 5–7 are the ones worth remembering: all three were *tests that had
stopped testing*, and each looked identical to a deliberate decision. That is
why the manifest validator refuses a pass without a raw artifact at the
candidate SHA, and why a skipped required suite can never produce a GO.

### What would change the public-paid verdict

Nothing in the code. Four items, ordered by risk removed per hour:

| # | Action | Effort |
|---|---|---|
| 1 | Seed the fixtures and run the full authenticated matrix (`P1-AUTH-E2E-AT-HEAD`) | ~20 min |
| 2 | One real €9.99 transaction: charge → cancel → reactivate → portal → refund (`P0-LIVE-TRANSACTION`) | ~30 min |
| 3 | Reminder/cron/email rehearsal using the worksheet in `docs/ops-cron.md` (`P1-REMINDER-REHEARSAL`) | ~45 min |
| 4 | Key rotation + isolated restore drill (`P1-ROTATION-RESTORE`) | ~60 min |

Record each result in §3. When all four carry evidence and no stop criterion is
open, the public-paid verdict may be revisited — **by a human**.

_Signed (automated evidence only): Claude Code, at RC `0025a502` on `v11`.
Public-paid sign-off remains with the owner and is not granted here._
