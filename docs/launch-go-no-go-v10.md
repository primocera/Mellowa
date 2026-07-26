# Launch go/no-go scorecard — v10 (MW-V10-00 …)

**Status: IN PROGRESS.** This document is opened by MW-V10-00 and frozen by
MW-V10-08. Until that freeze it records the running state of the v10 branch and
must not be read as a release verdict.

**Branch:** `v10`. **Baseline:** `90f54823a08fd0b5c3a8b7145e089beee44c21c7`
(= `main` at the start of v10; no drift). **RC SHA:** _not yet frozen — set by
MW-V10-08._

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
| Unit/contract/safety suite | `npx vitest run` | ✅ **719 passed / 76 files** |
| Adversarial red-team matrix | `npx vitest run tests/adversarial-matrix.test.ts` | ✅ within the suite |
| Safety + eval gate | `npm run eval` | ✅ within the suite |
| Production build | `npm run build` | ✅ clean |
| Public browser journeys | `npm run test:e2e:public` | ✅ 39 passed across desktop / 375px / **320px** |
| **Daily-journey state matrix** | `npm run test:e2e:journey` | ⛔ **not run — no seeded env.** 33 tests exist; unrun tests are not evidence. |
| **Authenticated browser journeys** | `npm run test:e2e` | ⛔ **not run — no seeded env. Non-green for RC.** |
| Env/readiness presence | `npm run release-check` | ⚠ run with production env pulled |

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
- [ ] **Reminder / cron / email** live rehearsal: opt-in preview, quiet hours,
      pause/skip, idempotent send, no sensitive content, dead-letter check,
      **and a real click on the unsubscribe link from a mail client** —
      including the native Gmail/Apple Mail unsubscribe button, which exercises
      the one-click `POST` path rather than the footer link. Evidence: __
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
| 6 | P2 | Beta invite cap + stop-acquisition switch absent (MW-V10-06) | Eng | Cap enforced, switch works without data loss |
| 7 | P2 | Ceiling-denial counting not instrumented | Eng | Denial logging or accept |
| 8 | P2 | Public Lighthouse/perf never measured at an RC | Owner | Manual run before launch |

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

## 6. Verdict

- **Automated code gate:** ✅ GO — lint, typecheck, 719 tests, build and the
  39 public Playwright journeys green on `v10`. The 33-test authenticated state
  matrix is **not** part of this GO: it has never been executed.
- **Capped private beta (≤50 invites, no card for the sample):** ✅ GO, on the
  same terms as v9.
- **Public paid launch: NO-GO.** P0 #1 is open and owner-run. P1 #2–#4 are open.
  This is honest and expected: a code-complete branch is not a proven paid
  product, and the three defects found in MW-V10-00 are direct evidence that a
  large green unit suite does not establish that user-facing paths work.

_Signed (automated evidence only): Claude Code, on `v10`. Public-paid sign-off
remains with the owner after §3 evidence is recorded. Frozen RC verdict is set
by MW-V10-08._
