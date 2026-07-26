# Launch go/no-go scorecard — v10 (MW-V10-00 …)

**Status: FROZEN (MW-V10-08).** This is the release-candidate verdict for v10.
Nothing below is a plan; every line is either a measured result, an explicitly
unrun check, or an owner action with an owner and a date.

**Branch:** `v10`. **Baseline:** `90f54823a08fd0b5c3a8b7145e089beee44c21c7`
(= `main` at the start of v10; no drift).
**RC SHA:** `e817aa4f4bdc3f0a9eeed0d30e3210aa2c1d968f`

The RC is the last functional commit (MW-V10-07). MW-V10-08 adds **no product
code** — only `tests/rc-gate.test.ts`, which verifies the claims this document
makes, plus this freeze. That is why the RC SHA is not the branch tip: freezing
the gate's own commit would mean the verdict described code the gate had not
been run against.

Supersedes `launch-go-no-go-v9.md`, which stays as history. The current
built-vs-proven picture lives in `docs/BUILD_STATE.md`.

**Status vocabulary is exact and load-bearing:** *tested* (automated in-repo) ·
*configured* (infrastructure set, never exercised) · *rehearsed live* (a human
ran it against production) · *observed* (seen in real production traffic).
Nothing below claims production behaviour was verified from tests or mocks.

---

## 1. Automated gates — measured on `v10`

| Gate | Command | Status |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 errors (8 pre-existing warnings, untouched files) |
| Type safety | `npm run typecheck` | ✅ clean |
| Unit/contract/safety suite | `npx vitest run` | ✅ **873 passed / 80 files** |
| Adversarial red-team matrix | `npx vitest run tests/adversarial-matrix.test.ts` | ✅ within the suite |
| Safety + eval gate | `npm run eval` | ✅ 81 passed — now includes the MW-V10-04 golden fit/variety gates |
| Production build | `npm run build` | ✅ clean |
| Public browser journeys | `npm run test:e2e:public` | ✅ **48 passed** across desktop / 375px / 320px, now including landmark, heading, focus-visibility and measured 44px-target checks |
| **Daily-journey state matrix** | `npm run test:e2e:journey` | ⛔ **not run — no seeded env.** 33 tests exist; unrun tests are not evidence. |
| **Authenticated browser journeys** | `npm run test:e2e` | ⛔ **not run — no seeded env. Non-green for RC.** |
| Env/readiness presence | `npm run release-check` | ⚠ run with production env pulled |
| Optional live provider eval | `scripts/eval-live.mjs` | ⏭ **SKIPPED by design** — opt-in, advisory, cannot gate a release |

The authenticated row is now enforced, not merely annotated: setting the
`RC_GATE` repository variable to `1` makes CI **fail** when the seeded
environment is absent (`.github/workflows/ci.yml`). Before v10 a skipped
authenticated suite still produced a green check.

## 2. What v10 has changed so far

### MW-V10-00 — live transaction closure and production operations

Three defects were found in code that the 604-test v9 suite reported green.
Each was a *missing mechanism* rather than a wrong value, which is why contract
tests could not see them. Full write-up in `docs/BUILD_STATE.md` §0.

1. **Reminder email had no unsubscribe at all** — no link, no
   `List-Unsubscribe` header, no route. The footer claimed the reminders could
   be turned off in Settings and linked nowhere; Settings requires a login.
   Now: signed one-click opt-out (`src/lib/email/unsubscribe.ts`,
   `/api/email/unsubscribe`), works signed out, RFC 8058 `POST` + `GET`,
   headers on the provider send. Billing and account mail stay
   non-unsubscribable by design.
2. **Paid but no access.** Checkout writes `status = 'incomplete'` with a NULL
   `stripe_subscription_id`; only the webhook fills it in. A dropped webhook
   therefore left a paying user with `generate = false` — and the daily
   reconcile selected `.not("stripe_subscription_id","is",null)`, skipping
   exactly those rows. Now: `adoptSubscriptionForCustomer`, an orphan sweep in
   the reconcile, and a sync on return from checkout. An adoption sets
   `report.ok = false`, because the row is repaired but the dropped webhook
   still needs an owner.
3. **Email confirmation failed cross-device.** The callback handled only the
   PKCE `code`, which needs the verifier cookie from the signup browser, so
   opening the mail on a phone read as "link expired". Now: the
   device-independent `token_hash`/`verifyOtp` path, with recovery links routed
   to the password form.

Also in this slice:

- `/api/health/ready` now proves the **RPC overloads the app actually calls**
  (`claim_ai_generation` 7-arg, `undo_plan_repair` 3-arg), not just that two
  tables exist. The probe passes a malformed uuid so argument coercion fails
  before the body runs — it can never consume a generation or mutate a plan.
  A missing overload previously surfaced as a 500 on a user's first generation
  after deploy.
- `charge.refunded` and `charge.dispute.created` are handled, so the owner-run
  refund step of the rehearsal is observable in the product's own billing
  health rather than only in the Stripe dashboard. A dispute is logged for an
  owner and never triggers an automated access change.
- `docs/runbooks/key-rotation-and-backup.md` — the rotation order, the
  overlap-then-revoke procedure that makes every step reversible, and a restore
  drill whose measured wall-clock time is the real RTO.

### MW-V10-01 — adaptive-day positioning

The landing now leads with the differentiator ("When your day changes, reshape
what's left — without starting over") and shows the full loop above the fold,
including the two beats that are the actual wedge: completed items stay, and
Undo is free. The concrete sample day moved up to sit directly after the hero.

Copy is down ~11% (about 1640 → 1465 visible words) by removing duplicated
truth — the "how it works" cards restated the new hero loop. **This is short of
the 20-25% the prompt targets.** Closing the gap would require cutting safety
boundaries, sample/trial disclosure or pricing detail, which the same prompt
forbids, so it is recorded as a shortfall rather than taken from copy that
protects users. Metadata and JSON-LD were rewritten to match the new promise.

### MW-V10-02 — trial-value alignment and the 3-day vs 7-day experiment

Trial length is now server-owned rather than a constant. `TRIAL_DAYS` and
`PRICING.trialDays` are **deleted**: every surface reads the length from
`src/lib/stripe/trial-experiment.ts`, and a contract test fails the build if any
page, component or email names a fixed number of trial days again.

- **Assignment** is deterministic from the user id, allowlisted
  (`control` = 3, `week_beta` = 7) and opt-in. With no env set the experiment is
  inactive and everyone gets the 3-day control — production behaviour is
  unchanged by this slice.
- **Pinned at trial creation.** The checkout route writes
  `subscriptions.trial_variant` / `trial_days` (migration `036`, additive)
  *before* creating the Stripe session, and refuses to open checkout if that
  write does not land — an unpinned disclosure would not be reproducible from
  stored state. Once pinned, the day count outranks the flag, the rollout
  percentage and the allowlist, so **no live trial can be re-timed**. The
  webhook then overwrites it with the length Stripe actually granted.
- **The client derives nothing.** The checkout response carries `trialDays` and
  an exact `chargeDate`; the confirmation card renders them and refuses to show a
  confirmation without a server date. The previous `today + TRIAL_DAYS`
  arithmetic in the browser is gone.
- **Consistency fix found while doing this:** `/billing` rendered the trial
  footnote ("Cancel before …") to users who had already consumed their trial,
  because it never passed `trialEligible` to the upgrade button. It now passes
  both eligibility and the server charge date, and a Playwright test asserts a
  prior-trial user sees pay-today copy only.
- **Anonymous surfaces.** With no user there is no assignment, so the landing and
  legal pages name the control length only while the experiment is inactive; once
  a cohort is being assigned they state that the exact length and charge date are
  shown before checkout. Verified by building with the flag on and reading the
  prerendered HTML — the deploy that enables the experiment re-renders them, and
  on Vercel an env change reaches only a new deployment, so they cannot drift
  apart from `/pricing`.
- **Week preview.** A trial shorter than a week now shows a clearly labelled
  example of a week closeout on `/weekly-plan` (suppressed as soon as the user
  has a recorded week). It contains no numbers and no second-person past tense,
  and its carry-forward illustration reads the real `CARRY_EFFECTS` mapping — so
  nothing is promised that the generator would not do. No fictional history is
  generated.
- **Measurement.** Billing events carry `experiment: trial_days:<variant>` — a
  code and nothing else. The `/admin` comparison is computed from the *pinned*
  variant, not from events, so it survives the flag being turned off; arms under
  five people report "not enough data" rather than 0%.
- **Stop rules** — including "any unexpected charge is an immediate stop" and "no
  retention lift after 50 completed trials per arm" — are in
  `docs/experiments/trial-length.md`, with the owner-run enable procedure.

Not changed: €9.99 / €59.99, the refund policy, and the yearly-emphasis default.
`FLAG_EMPHASIZE_YEARLY` must stay off while this experiment runs — two
overlapping onboarding experiments would make neither readable.

### MW-V10-03 — authenticated daily journey and failure states

The Now-first loop was already built. What was missing was any statement of what
happens when it *doesn't* work, and any browser evidence at all.

- **A billing state the user cannot fix now has a route.** A `past_due`,
  `unpaid` or `canceled` user previously had **no signal on any authenticated
  surface** — they discovered it inside a 402 error at the moment they tried to
  generate. `BillingRecoveryBanner` (in the app layout, so every surface) states
  what is still readable *before* what is blocked, with exactly one CTA to
  `/billing`. Read access was never actually revoked; nothing said so.
- **Never two banners.** A trial set not to renew used to show "trial is
  active — 2 days left" (implying a charge) next to nothing explaining the
  cancellation. The trial banner now stands down and the recovery notice owns
  that state.
- **Completion is server-confirmed.** Two real defects: a double tap fired two
  requests whose replies could land in either order, leaving the UI showing a
  state the database did not have; and the Now card set "Marked done" at click
  time, so a *failed* save still told the user the item was done. Now one save
  per item is in flight at a time, a second tap is dropped rather than queued as
  a toggle-back, the final state comes from the server's own `{ item_key, done }`
  reply, and the confirmation appears only after it. Failure copy states the
  resulting state explicitly instead of the ambiguous "your plan is unchanged".
- **A stale tab moves forward, never backward.** `409 repair_in_progress`,
  `409 version_conflict` on Undo, and a deduplicated repair each get their own
  message and a "Reload today" control. On a version conflict the **newer plan
  is kept** — undoing to the version the open page remembers would silently
  discard work done in another tab. No code path offers to overwrite it.
- **State matrix.** `e2e/daily-journey.spec.ts` — 33 tests over eight seeded
  states at desktop / 375px / 320px, checking one primary action per state, no
  horizontal overflow, the fixed bottom nav not covering a control, keyboard
  reachability, and the absence of celebration/streak/adherence language.
  `scripts/seed-test-user.mjs --state=<s>` produces each state and rebuilds the
  plan every run so states cannot leak. **This suite has not been executed** —
  it is code, not evidence, until someone runs it against a seeded environment.
- Also fixed: `e2e/journeys.spec.ts` searched for `/start 3-day free trial/i`, a
  string the pricing page has never rendered. It could only ever have failed —
  and never did, because the suite has never run.

No migration, no flag, no analytics event. Rollback is a revert of the two
components; nothing was written to the database by this slice.

### MW-V10-04 — plan usefulness and safety golden evaluation

The eval gate could prove a plan was safe, in-schema and on-tone. It could not
prove the plan was *usable*, and it could not see a week at all.

- **Fit is now a hard eval gate** (`src/lib/evals/fit.ts`): a meal that exceeds
  the cooking time the user stated, a "minimum" day that quietly asks for two
  hours, a plan that invents a partner/kids/gym/medication the input never
  mentioned, generic filler in a slot that must be specific ("Eat healthy" as a
  meal title), and a low-energy day with no smaller versions. A `low_energy_swap`
  explicitly does **not** excuse an over-budget primary suggestion.
- **Repetition is detectable for the first time** (`src/lib/evals/repetition.ts`).
  No previous check could see it, because every check looked at one plan in
  isolation — four identical days passed everything. Declared favourites and
  leftovers are excluded (that reuse is the product working), and the recurring
  habit is never reported. A rename with identical ingredients is caught.
- **The fixture is now built per case.** A single generic fixture asserted
  against every case only proved the fit gate was asleep; `safeFixturePlanFor`
  builds the plan a competent generation *should* have produced, so a failure
  means a validator is wrong rather than the fixture being mismatched.
- **Repair preservation is asserted, not assumed** — every completed/kept key
  across five done/kept combinations must be protected and out of replaceable
  scope.
- **Provenance** (migration `037`, additive): `prompt_version`, `model_version`
  and `is_fallback` travel with the plan. The curated backup day is now
  **labelled to the user** — unlabelled it read as a plan built for them. The
  summary shows version ids only; a prose "version" is rejected by a slug check,
  so prompt text cannot reach the client.
- **Human rubric rewritten** (`docs/eval-worksheet.md`): seven dimensions with
  1/3/5 anchors so two reviewers land within a point, a required comment column,
  and explicit blocking rules (any 1 blocks; a mean under 3.0 on any single
  dimension blocks; improve one dimension at a time).
- **Optional live eval** (`scripts/eval-live.mjs`): opt-in, cost-capped, records
  model + UTC date, prints `SKIPPED` when unconfigured, exits 0 always, and goes
  through `/api/ai/daily-plan` rather than the provider — so it cannot bypass the
  safety classifier, the allergen gate or the fair-use claim. **No LLM judges
  safety anywhere.** Verified by running it: both skip paths exit 0.

Fit findings are reported under their own codes, so a fit failure is never
mistaken for — or able to mask — a safety failure. A test asserts both are
reported together for a plan that is unsafe *and* unusable.

### MW-V10-05 — reminder, timezone, cron and lifecycle reliability

One planner now owns every reason a reminder is or is not sent, in a fixed
order, so no caller can implement half the rules.

- **Consent was recorded but never enforced.** `reminder_consent_version` was
  written by the settings form and read by nothing — the constant was declared
  inside the form component. It now lives in the planner and is checked before
  every send, failing closed on a missing or older version. **Consequence to
  know:** anyone who opted in before versioning has a NULL version and will not
  receive reminders until they re-confirm. That is the safe direction, and
  reminders have never been sent to real users (the rehearsal below is still
  unrun), but it is a real behaviour change.
- **Two conflicts the product had with itself.** A `past_due`, `unpaid` or
  `canceled` user was still being nudged to "open Mellowa and check in" — into a
  paywall. And a user with a recent crisis or eating-disorder safety signal was
  still receiving activity nudges. Both are now suppressed, safety first, before
  any other rule can decide to send.
- **The dedupe key moved into the planner.** It was a template string at the
  call site; a divergent key is a duplicate email.
- **Cron run leases** (migration `038`, additive): an overlapping or retried
  trigger is a no-op instead of a second full scan. This is *not* what prevents
  duplicate emails — the ledger's unique `event_key` is, and it works whether or
  not the lease does. The lease **fails open** on purpose: a problem with the
  lease table must never silently stop reminders for everyone.
- **Timing is now disclosed honestly.** Vercel Hobby gives one daily run, not a
  to-the-minute scheduler. The settings screen states exactly what we can keep —
  never earlier than the chosen time, sometimes later, at most one per day —
  from a single string the tests assert. `docs/ops-cron.md` documents the three
  timing cases for operators.
- **Delivery health is observable without reading anyone's mail.** `/admin` now
  shows backlog, oldest stuck item, dead letters per template and delivery rate.
  The query deliberately never selects `to_email`, `subject` or `html`, and a
  test asserts that.
- **Owner rehearsal worksheet** added to `docs/ops-cron.md`: seven sections
  including the native Gmail/Apple Mail one-click unsubscribe path, a
  deliberate provider break, and the `past_due`/`canceled` suppression checks.

DST is covered by fixtures: the same 08:00 local resolves to a different UTC
instant in winter and summer, and repeated runs across one local day send once.

### MW-V10-06 — retention beta and evidence-backed decisions

- **The beta cap is now real.** "≤50 invites" was a number in a document
  enforced by nobody — nothing stopped the 51st signup, and there was no way to
  stop intake at all if a stop criterion fired. Enforcement is a **database
  trigger** (migration `039`), not a form check: signup goes through
  `supabase.auth.signUp` from the browser, so a UI check is a courtesy, not a
  cap. Closing intake **deletes nothing** — it blocks new rows only, so a stop
  is instantly reversible. It fails **open** when unconfigured, so a missing
  settings row can never lock everyone out (verified locally: with migration
  `039` unapplied the signup form still renders).
- **Every funnel step now carries a decision.** The dashboard showed the loop
  but not what to do about any number on it, so a weak step produced a shrug.
  Each step now shows numerator / denominator / rate / hypothesis / state /
  action, and **"no data" (cohort under 5) and "below hypothesis" are separate
  states** — conflating them is how a beta talks itself into expanding. None of
  the weak-step actions is "add a notification".
- **One expansion verdict**, on the dashboard: BLOCKED until next-day return
  meets its hypothesis *over a four-week window*. Widening intake cannot happen
  by momentum.
- **Cost per outcome**, where `null` means unknown and is rendered as
  "unknown", never `$0.00` — a zero reads as "this costs us nothing", which is
  the opposite of no data. Uncovered inputs (Stripe fees, infrastructure) are
  named rather than silently excluded.
- **Overlapping experiments are detected.** "One experiment at a time" was
  written in `docs/experiments/trial-length.md` and enforced by nobody; the
  dashboard now raises a conflict naming both experiments and how to turn one
  off. Deliberately advisory, not fail-closed — silently disabling an arm
  mid-flight could re-time a pinned trial.
- **Weekly memo** in `docs/beta-research.md` now names five outcomes with
  triggers, so **Continue is a choice rather than what happens when nobody
  decides**, and states that cancellation is never blocked or delayed by
  research.

### MW-V10-07 — mobile polish, accessibility and failure states

The audit found real defects rather than cosmetic ones, and the new browser
checks are what found most of them.

- **Today could present another day's plan as today's.** For a profile with an
  unusable timezone the query fell back to a rolling `plan_date >= yesterday`
  window, and the page then labelled the result "Today · plan ready". A user
  would have followed a day built for different conditions. The plan's own
  `plan_date` is now always compared against the resolved local date; a
  non-matching plan is named with its real date and framed as history.
- **The public routes had no error boundary at all.** `(app)/error.tsx` covered
  the authenticated shell, so a failed read on the landing, pricing or legal
  pages showed Next's default error screen — on the first page a prospective
  user sees. Added `app/error.tsx` and `app/global-error.tsx`; the latter renders
  its own document and imports nothing shared, because any import could be the
  module that failed.
- **No `<main>` landmark on any public page**, so a screen-reader user had
  nothing to skip the navigation to. Added to the landing, pricing and auth
  layouts (legal pages already had one).
- **Touch targets below the AA minimum on the most-used controls.** The landing
  nav links were 20px and the legal/support footer links 16px — the links a user
  reaches for when they want to leave or complain. On Today, the Now card's
  Done/Not now buttons were ~36px, the defer-reason chips ~30px, and the repair
  sheet's "Keep this" toggle ~20px — the control that decides what a repair may
  overwrite. All now 44px, via the shared primitive where one applies.
- **Loading boundaries** added for check-in, billing and You (previously only
  Today and Week), so the three remaining daily routes no longer blank. Billing
  matters most: that page can sync with Stripe on return from checkout, which is
  the slowest read in the app and the worst place for a blank screen.
- **One round trip removed from Today** by running the profile and plan reads in
  parallel — possible only because the plan query no longer depends on the
  timezone.

The 44px check measures the **effective** target: a checkbox's wrapping
`<label>` counts, because tapping the text toggles it, and inline links inside
body copy are exempt by design. Both exemptions are documented in the test
rather than assumed.

**No Lighthouse score is claimed.** LCP/CLS/INP have not been measured at an RC;
P2 #8 stays open.

## 3. Live rehearsal — owner must execute (evidence required)

None of these can be proven from this environment. Claude Code must not mutate
live Stripe, Supabase, Vercel, Resend, DNS or cron.

- [x] Migrations `027`–`033` applied to live Supabase — 2026-07-21, before the
      v8 merge.
- [x] Migrations `034`/`035` applied to live Supabase — 2026-07-23. **Confirm
      via `/api/health/ready`**, which now checks the overloads directly.
- [x] Live Stripe configuration switched 2026-07-21 (live key, webhook +
      signing secret, two live EUR price ids). *Configured only.*
- [ ] **One real low-value transaction** end to end: signup → sample → sample
      adjustment → live trial checkout → exact charge disclosure → daily repair
      + Undo → cancel → reactivate → billing portal → refund. Evidence: __
- [ ] **Reminder / cron / email** live rehearsal — the worksheet is now written
      out step by step at the end of `docs/ops-cron.md` (consent preview, the
      disclosed timing window, pause/skip/disable, double-trigger idempotency,
      the native Gmail/Apple Mail one-click unsubscribe, a deliberate provider
      break and dead-letter recovery, and `past_due`/`canceled` suppression).
      Evidence: __
- [ ] **Authenticated seeded E2E** — both `npm run test:e2e` and the MW-V10-03
      state matrix `npm run test:e2e:journey` (8 seeded states × 3 viewports),
      with `seed:test-user`, against staging. Evidence: __
- [ ] **Key-rotation drill + backup/rollback rehearsal** — procedure and
      evidence template in `docs/runbooks/key-rotation-and-backup.md`.
      Evidence: __

## 4. P0 / P1 / P2

| # | Level | Item | Owner | Acceptance |
|---|---|---|---|---|
| 1 | **P0** | Live transaction rehearsal (charge→cancel→reactivate→refund) unrun | Owner | Recorded evidence in §3 |
| 2 | **P1** | Authenticated seeded E2E not run in this environment | Owner/CI | Green run recorded; `RC_GATE=1` enforces it |
| 3 | **P1** | Reminder/cron/email live rehearsal, incl. one-click unsubscribe | Owner | Evidence in §3 |
| 4 | **P1** | Key rotation + backup/restore drill never rehearsed | Owner | Evidence in §3 |
| ~~5~~ | ~~P2~~ | ~~Trial-length experiment infrastructure absent (MW-V10-02)~~ | — | **Closed.** Server-owned, pinned, allowlisted assignment; experiment shipped but **not running** |
| ~~6~~ | ~~P2~~ | ~~Beta invite cap + stop-acquisition switch absent (MW-V10-06)~~ | — | **Closed.** Enforced by a database trigger (migration `039`); closing intake deletes nothing and fails open when unconfigured |
| 7 | P2 | Ceiling-denial counting not instrumented | Eng | Denial logging or accept |
| 8 | P2 | Public Lighthouse/perf never measured at an RC | Owner | Manual run before launch. **Still unmeasured** — MW-V10-07 removed a round trip from Today and added loading boundaries, but no LCP/CLS/INP number has been taken, so no score is claimed. |

## 5. Rollback triggers

Any of: unsafe or allergen-miss output reaching a user; duplicate charge or
duplicate generation; repair corruption; privacy leak (including sensitive data
in analytics, logs or email); reminder complaint spike or dead-letter growth;
**a reconcile report containing `adoptedSubscriptions`**, which means webhooks
are being dropped and users are paying without access; **any trial charged on a
date the user was not shown**, which is also an immediate stop for the
trial-length experiment (`docs/experiments/trial-length.md`).

Rollback paths are flag-based and data-safe: `FLAG_MONTHLY_FAIR_USE=0`,
`FLAG_PLAN_REPAIR=0`, `FLAG_WEEKLY_REFLECTION=0`, `FLAG_EMPHASIZE_YEARLY`
unset, `FLAG_TRIAL_LENGTH_EXPERIMENT=0` (pinned trials complete exactly as
disclosed — no subscription is touched), plus per-surface UI reverts. Every v9/v10 migration is additive, so no
migration reversal is required to roll back any behaviour.

## 5b. Pinned contract versions at the RC

Anything below that changes makes this a different release candidate. Verified
against the code by `tests/rc-gate.test.ts`, not copied by hand.

| Contract | Pinned value |
|---|---|
| Daily-plan prompt | `daily-plan-v2@1` (sha256 in `src/prompts/versions.ts`) |
| Other prompts | `daily-plan@1`, `weekly-plan@1`, `habit-plan@1`, `low-energy-day@1`, `meal-rhythm@1`, `journal@1`, `safety@1` |
| Model | `AI_PROVIDER_MODEL`, default `claude-haiku-4-5-20251001`; per-route policy in `src/lib/ai/model-policy.ts` |
| Analytics taxonomy | analytics v1 — closed event enum, closed property keys |
| Migrations | `001`–`039`. v10 adds `036` (trial experiment), `037` (plan provenance), `038` (cron leases), `039` (beta capacity) — all additive |
| Reminder consent | `2026-07` |
| Trial variants | `control` = 3 days, `week_beta` = 7 days — experiment **inactive** |
| Kill-switch flags (default ON) | `weekly_plan`, `journal_reflection`, `meal_regeneration`, `reminders`, `fallback_plan`, `plan_repair`, `weekly_reflection`, `monthly_fair_use` |
| Opt-in flags (default OFF) | `FLAG_EMPHASIZE_YEARLY`, `FLAG_TRIAL_LENGTH_EXPERIMENT` |

**Migration rollback dry run.** Every migration in the repository was scanned for
`drop table`, `drop column`, `truncate`, top-level `delete from` and destructive
type changes — **none present**. The only `delete from` statements sit inside
`undo_plan_repair`, where consuming the snapshot row *is* the Undo. Every v10
migration is re-runnable (`if not exists` / `create or replace` / `on conflict`).
A rollback is therefore a flag change or a code revert; no migration reversal is
required. Live presence is confirmed only through `/api/health/ready` — Claude
Code never touches the live database.

## 6. Verdict

### Measured at the RC

Every command below was run at `e817aa4`. Nothing here is inferred.

| Command | Result |
|---|---|
| `npm run lint` | ✅ 0 errors, 8 warnings (pre-existing, untouched files) |
| `npm run typecheck` | ✅ clean |
| `npx vitest run` | ✅ **900 passed / 81 files** |
| `npm run eval` | ✅ 81 passed (safety + golden fit/variety gates) |
| Safety suites (`safety`, `safety-matrix`, `adversarial-matrix`, `severe-allergy`, `output-guards`, `crisis-resources`) | ✅ 73 passed |
| Privacy suites (`privacy-registry`, `analytics-contract`, `consent`) | ✅ 26 passed |
| `npm run build` | ✅ clean |
| `npm run test:e2e:public` | ✅ 48 passed × desktop / 375px / 320px |
| `git diff --check` | ✅ clean |
| `npm run release-check` (local, no secrets) | ✅ **fails closed as designed** — 14 missing, 4 warnings, "NOT ready", and **no value printed**. Owner must re-run with production env pulled. |
| `npm run test:e2e` + `npm run test:e2e:journey` | ⛔ **NOT RUN** — no seeded environment. 66 authenticated tests exist and have never executed. |
| `scripts/eval-live.mjs` | ⏭ SKIPPED by design (opt-in, advisory, cannot gate a release) |
| Lighthouse / Web Vitals | ⛔ **NOT MEASURED.** No score is claimed anywhere. |

### Verdict

- **Automated code gate:** ✅ GO at `e817aa4` — lint, typecheck, 900 tests, the
  81-test eval gate, build and the 48 public browser journeys green. **Not** part
  of this GO: the 66 authenticated tests (never executed), the live provider eval
  (skipped by design) and any performance number (never measured).
- **Capped private beta (≤50 invites, no card for the sample):** ✅ GO — and as
  of MW-V10-06 the cap is *enforced* by a database trigger rather than
  documented, so "≤50" is a fact instead of an intention. Requires migration
  `039` applied.
- **Public paid launch: NO-GO.**

  P0 #1 (live transaction) and P1 #2–#4 (authenticated E2E, reminder/email
  rehearsal, key-rotation drill) are open, and every one is owner-run. Under the
  rule that no GO may be marked with an open transaction, safety, allergen,
  privacy, billing or authenticated-E2E P0/P1, this verdict cannot be anything
  else.

  This is the expected outcome, not a failure of the work — and the record shows
  why the rule exists. **Every slice in v10 found a defect in code the suite
  reported green:** a consent version nobody read, a `trialEligible` flag never
  passed to the component, `past_due` users nudged into a paywall, a stale plan
  labelled as today's, and an E2E assertion matching a string the app has never
  rendered. A 900-test suite caught none of them. Live and authenticated evidence
  is a precondition, not a formality.

### What would change this verdict

Nothing in the code. Four owner-run items, ordered by risk removed per hour:

| # | Action | Why it comes first | Effort |
|---|---|---|---|
| 1 | Seed the E2E environment (`npm run seed:test-user` + 3 env vars) and run both authenticated suites | Unblocks 66 tests that have never run; MW-V10-03 proved this gate currently does nothing | ~5 min + one run |
| 2 | Apply migrations `036`–`039` to live Supabase; confirm via `/api/health/ready` | Four v10 mechanisms (trial pinning, provenance, cron leases, beta cap) enforce nothing until applied | ~10 min |
| 3 | One real low-value transaction end to end (charge → cancel → reactivate → portal → refund) | The only P0 | ~30 min |
| 4 | Reminder/cron/email rehearsal using the worksheet at the end of `docs/ops-cron.md` | Delivery is not *observed* until a message lands in a real inbox | ~45 min |

Record each result in §3. When all four carry evidence and no stop criterion is
open, the public-paid verdict may be revisited — by a human.

_Signed (automated evidence only): Claude Code, at RC `e817aa4` on `v10`.
Public-paid sign-off remains with the owner and is not granted here._
