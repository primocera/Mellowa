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
| Unit/contract/safety suite | `npx vitest run` | ✅ **621 passed / 74 files** |
| Adversarial red-team matrix | `npx vitest run tests/adversarial-matrix.test.ts` | ✅ within the suite |
| Safety + eval gate | `npm run eval` | ✅ within the suite |
| Production build | `npm run build` | ✅ clean |
| Public browser journeys | `npm run test:e2e:public` | ⚠ run on demand (Playwright) |
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
- [ ] **Authenticated seeded E2E** (`npm run test:e2e` with `seed:test-user`)
      against staging. Evidence: __
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
| 5 | P2 | Trial-length experiment infrastructure absent (MW-V10-02) | Eng | Server-owned variant assignment |
| 6 | P2 | Beta invite cap + stop-acquisition switch absent (MW-V10-06) | Eng | Cap enforced, switch works without data loss |
| 7 | P2 | Ceiling-denial counting not instrumented | Eng | Denial logging or accept |
| 8 | P2 | Public Lighthouse/perf never measured at an RC | Owner | Manual run before launch |

## 5. Rollback triggers

Any of: unsafe or allergen-miss output reaching a user; duplicate charge or
duplicate generation; repair corruption; privacy leak (including sensitive data
in analytics, logs or email); reminder complaint spike or dead-letter growth;
**a reconcile report containing `adoptedSubscriptions`**, which means webhooks
are being dropped and users are paying without access.

Rollback paths are flag-based and data-safe: `FLAG_MONTHLY_FAIR_USE=0`,
`FLAG_PLAN_REPAIR=0`, `FLAG_WEEKLY_REFLECTION=0`, `FLAG_EMPHASIZE_YEARLY`
unset, plus per-surface UI reverts. Every v9/v10 migration is additive, so no
migration reversal is required to roll back any behaviour.

## 6. Verdict

- **Automated code gate:** ✅ GO — lint, typecheck, 621 tests and build green
  on `v10`.
- **Capped private beta (≤50 invites, no card for the sample):** ✅ GO, on the
  same terms as v9.
- **Public paid launch: NO-GO.** P0 #1 is open and owner-run. P1 #2–#4 are open.
  This is honest and expected: a code-complete branch is not a proven paid
  product, and the three defects found in MW-V10-00 are direct evidence that a
  large green unit suite does not establish that user-facing paths work.

_Signed (automated evidence only): Claude Code, on `v10`. Public-paid sign-off
remains with the owner after §3 evidence is recorded. Frozen RC verdict is set
by MW-V10-08._
