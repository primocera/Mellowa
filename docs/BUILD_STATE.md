# Build state — read this before writing the next prompt pack

**Purpose:** this is the single canonical answer to "what is already built and
what is actually open." It exists because prompt packs v8, v9 and v10 re-asked
for work that was already shipped. If you are scoping a new pack from the public
repo, read this file first — not the individual `launch-go-no-go-*.md` history.

**The active release truth is `docs/release/manifest.v11.json`**, with
`docs/launch-go-no-go-v11.md` as its human form. A test fails the build if the
two disagree. This file is the built-vs-proven map; it does not carry the
verdict, and where it and the manifest differ the manifest is right.

**Last verified:** 2026-07-26 on branch `v11` at baseline
`169c706` (= `main`; confirmed as the actual HEAD). Automated suite:
**900 tests / 81 files green**, lint clean (0 errors), typecheck clean,
production build clean, **51 public Playwright journeys green** across desktop /
375px / 320px. Raw logs for every one of those are in
`docs/release/evidence/v11/`.

**Authenticated browser evidence — read this precisely.** The 33-test state
matrix from MW-V10-03 was executed on 2026-07-26 against the deployed v10
preview (87 executions, green, migrations `036`–`039` applied). That run is
real, and it is history: it happened at the v10 evidence commit, and three
commits have landed since, one of which rewrote the landing header. So at the
current baseline the authenticated matrix is **not run** — not because the
earlier result was wrong, but because evidence from one commit does not certify
another. MW-V11-04 owns the rerun. This is the single sentence the v10 documents
managed to say two contradictory ways.

**v10 progress:** MW-V10-00 ✅ · MW-V10-01 ✅ (copy reduction fell short of
target — see `launch-go-no-go-v10.md`) · MW-V10-02 ✅ (infrastructure only; the
experiment is **not running**) · MW-V10-03 ✅ · MW-V10-04 ✅ · MW-V10-05 ✅
(live rehearsal still unrun — worksheet in `docs/ops-cron.md`) · MW-V10-06 ✅ ·
MW-V10-07 ✅ · MW-V10-08 ✅.

**v10 is complete.** Its RC was frozen at
`e817aa4f4bdc3f0a9eeed0d30e3210aa2c1d968f` and its scorecard is superseded.
The current public-paid verdict is **NO-GO**, with the open blockers listed in
`docs/launch-go-no-go-v11.md` §4 — **three owner-run**, three engineering.
Nothing in the code changes the owner-run three.

**Status vocabulary** (used strictly, same as the go/no-go docs):
*tested* = automated in-repo · *configured* = infrastructure set but not
exercised · *rehearsed live* = a human ran it against production · *observed* =
seen in real production traffic.

---

## 0. Read this before trusting section 1

**"Shipped and tested" does not mean "works."** Three real defects were found in
this repo on 2026-07-26 *in areas the suite reported green*, because a passing
contract test proves a function returns the right value — it cannot prove a
button is wired, a link exists, or a webhook arrived:

| Found | Why the suite missed it |
|---|---|
| Reminder emails had **no unsubscribe at all** — no link, no `List-Unsubscribe` header, no route. The copy said "turn these off in Settings" and linked nowhere, and Settings needs a login. | `email-templates.test.ts` asserted the copy was calm and non-shaming. Nothing asserted the opt-out *existed*. |
| **Paid but no access.** Checkout writes `status = 'incomplete'` with a NULL `stripe_subscription_id`; only the webhook fills it in. If that webhook drops, the user has paid and `generate` stays false — and daily reconciliation selected `.not("stripe_subscription_id", "is", null)`, so it skipped exactly the broken rows. | `billing-ops.test.ts` tested `diffSubscription` on rows that already had an id. The blind spot was in which rows were *selected*, not in the diff. |
| **Email confirmation failed cross-device.** The callback only handled the PKCE `code`, which needs the verifier cookie from the signup browser — so opening the mail on a phone reported "link expired". | No test exercised the callback with a `token_hash` link, because no test exercised the callback at all. |

All three are fixed on branch `v10` and now have failing-before/passing-after
coverage in `tests/lifecycle-recovery.test.ts`.

**So: run every prompt in a pack, including the ones that look already-done.**
Section 1 tells you where the code is, so you can *verify behaviour* instead of
rebuilding it. It does not tell you the behaviour is correct. The distinction
that matters is not "built vs not built" — it is **"proven by a browser or a
human vs asserted by a unit test."**

## 1. Shipped — verify these, don't rebuild them

Each line names the pack item that delivered it and where the code lives. Treat
this as a map for verification, subject to the warning above.

| Area | Delivered by | Where |
|---|---|---|
| Now-first IA (Today/Week/Saved/You), Patterns under You | MW-V9-01 | `src/app/(app)/`, `nav-copy.test.ts` |
| One-minute check-in + pre-generation summary | MW-V9-02 | `checkin-copy.test.ts` |
| Versioned Now selector + post-Done Undo | MW-V9-03 | `NOW_SELECTOR_VERSION`, `next-action.test.ts` |
| Repair trust: server-derived diff, scope preview, version-checked Undo, 409 on conflict | MW-V9-04 | migration `034`, `plan-repair.test.ts` |
| Personalization center, reset learned preferences with exact scope | MW-V9-05 | `feedback-learned.test.ts` |
| Per-favourite allergen revalidation, safe pantry chips | MW-V9-06 | `severe-allergy.test.ts` |
| Week as one loop (this week / carry forward / next week) | MW-V9-07 | `week-copy.test.ts` |
| Landing wedge + four-beat mechanism + three Premium jobs | MW-V9-08 | `src/app/page.tsx`, `landing-conversion.test.ts` |
| Binary PWA icons (192/512/maskable/Apple), shared UI primitives, error boundary, loading skeletons | MW-V9-09 | `public/`, `src/components/ui/`, `pwa-ui.test.ts` |
| Monthly fair-use cap (atomic, honest denial) + admin cost scorecard | MW-V9-10 | migration `035`, `FLAG_MONTHLY_FAIR_USE`, `unit-economics.test.ts` |
| Beta value-loop funnel on admin dashboard + research/interview scripts | MW-V9-11 | `src/app/admin/`, `docs/beta-research.md`, `value-analytics.test.ts` |
| Stripe webhook idempotency: `claim_stripe_event`, out-of-order guard by `event.created`, unknown-price fails loud, retryable vs terminal errors | v4 P14 + v6 | `src/app/api/stripe/webhook/route.ts`, `idempotency.test.ts` |
| Billing reconciliation: drift fix, duplicate-customer detection, stuck-webhook detection | v6 P18 | `src/lib/stripe/reconcile.ts`, `billing-ops.test.ts` |
| Reminder planner: quiet hours, timezone resolution, batching | v7/v8 | `src/lib/email/reminder-planner.ts`, `reminder-planner.test.ts` |
| Email outbox with retries + dead-letter | v6 | `email-outbox.test.ts`, `email-delivery.test.ts` |
| Safety classification before every generation, fail-closed; adversarial matrix | v4→v9 | `safety.test.ts`, `safety-matrix.test.ts`, `adversarial-matrix.test.ts` |
| Privacy registry, export/delete, analytics redaction | v6 | `privacy-registry.test.ts` |
| Entitlement matrix pinned to billing state | MW-V9-10 | `entitlement.test.ts` |
| CI with env-gated authenticated E2E that warns instead of silently passing | MW-V9-00 | `.github/workflows/ci.yml` |

## 2. Genuinely open — this is what a new pack should target

Verified absent or partial in the code as of `169c706`. The canonical, id'd list
is §4 of `docs/launch-go-no-go-v11.md`; this table is the narrative version and
must not contradict it.

| # | Gap | Evidence it is open | Owner |
|---|---|---|---|
| 1 | **One real transaction end to end** (charge → cancel → reactivate → portal → refund) | No recorded evidence; `launch-go-no-go-v9.md` §4 blank | Owner (not Claude — live Stripe) |
| 2 | **Authenticated seeded E2E not run at the current baseline** (`P1-AUTH-E2E-AT-HEAD`) | It *was* run on 2026-07-26 against the deployed v10 preview — 87 executions green, and that first run found four defects, all in the tests and the seed fixture rather than the product, including a fixture whose meal cards used the wrong field names, so Today was crashing into the error boundary and the matrix was asserting against a broken page. That evidence belongs to the commit it ran at. Three commits have landed since, so it must be re-run here. | Eng |
| 3 | **Reminder / cron / email live rehearsal** | Planner is *tested*, never *rehearsed live*. MW-V10-05 wrote the step-by-step worksheet (end of `docs/ops-cron.md`) and found two conflicts the tests could not see: `past_due`/`canceled` users were being nudged into a paywall, and users with a recent crisis signal were still receiving activity nudges. | Owner |
| 4 | **Key rotation + backup/rollback drill** | No runbook evidence recorded | Owner |
| ~~5~~ | ~~`/api/health/ready` validates only migrations `020`/`021`~~ | **Closed in MW-V10-00.** The probe now exercises the RPC overloads the app actually calls (`claim_ai_generation` 7-arg, `undo_plan_repair` 3-arg), passing a malformed uuid so coercion fails before the body runs — it can never consume a generation or mutate a plan | — |
| ~~6~~ | ~~Trial-length experiment infrastructure absent~~ | **Closed in MW-V10-02.** Server-owned allowlisted assignment pinned at checkout (`src/lib/stripe/trial-experiment.ts`, migration `036`); `TRIAL_DAYS` and `PRICING.trialDays` deleted so no surface can hardcode a length again. Default behaviour unchanged: 3-day control until the owner enables a cohort. | — |
| ~~7~~ | ~~Beta invite cap + stop-acquisition switch absent~~ | **Closed in MW-V10-06.** Database trigger on `auth.users` (migration `039`) — a form check would not have been a cap, because signup calls Supabase from the browser. Closing intake deletes nothing; unconfigured fails open. | — |
| ~~8~~ | ~~Refund / dispute webhook events unhandled~~ | **Closed in MW-V10-00.** Both `charge.refunded` and `charge.dispute.created` are in the webhook switch. A dispute is logged for an owner and never triggers an automated entitlement change. | — |
| 9 | Ceiling-denial counting not instrumented (`P2-DENIAL-COUNTING`) | Admin scorecard shows 0 denials by construction | Eng (P2) |
| 10 | Public Lighthouse/perf never measured at an RC | Still unmeasured at `169c706`. No score is claimed anywhere. MW-V11-05 owns it. | Eng |
| 11 | No in-app reminder opt-out confirmation surface (`P2-REMINDER-OPTOUT-SURFACE`) | Unsubscribe works from email (fixed in v10); Settings does not yet reflect "off because you unsubscribed" | Eng (P2) |
| 12 | Header accessibility is exempted rather than proven (`P1-HEADER`) | `e2e/public.spec.ts` returns `null` for any control inside `<header>`, so the 44px rule never sees them | Eng |
| 13 | Public commercial copy is ungrammatical (`P1-COMMERCIAL-COPY`) | The hero renders `you actually have.Tell Mellowa` with no space (a JSX text boundary); `trialOfferSentence(3)` returns "a 3 days trial" and `startTrialCta(3)` returns "Start 3 days free" | Eng |

## 3. Areas re-scoped repeatedly — verify behaviour, don't re-commission copy

These are implemented and contract-tested. A pack should still **exercise them**
(that is how the three §0 defects surfaced), but should ask for *verification and
the specific gap*, not another ground-up rewrite:

- **Landing page copy** — rewritten in v6, v7, v8, v9 (MW-V9-08) and again in
  v10 (MW-V10-01). `src/app/page.tsx`, with `landing-conversion.test.ts` and
  `content-audit.test.ts` pinning the claims. A sixth rewrite needs measured
  evidence that the current wedge underperforms, not a new adjective.
- **Mobile polish / accessibility** — shared UI primitives and PWA assets landed
  in MW-V9-09; `accessibility.test.ts` covers the contracts. What is genuinely
  missing is *measurement* (LCP/CLS/INP at an RC), not more components.
- **Daily journey (Today → Now → Done/defer/repair)** — the logic is done and
  contract-tested across v8 and v9. What is missing is **browser** proof
  (gap #2), which unit contracts structurally cannot provide.
- **Value-loop analytics** — the funnel exists (MW-V9-11). What is missing is
  the *intake control* (gap #7) and real cohort data, not more dashboards.

**The pattern:** the remaining risk is split in two, and packs usually only
address the first.

1. *Code that exists but was never exercised end to end.* This is where the
   three §0 defects lived. The cure is walking the real flow — click the link in
   the actual email, complete a real checkout, open the confirmation mail on a
   second device — not more unit tests.
2. *Evidence only a human can produce in production* (gaps #1–#4). Claude Code
   must never mutate live Stripe, Supabase, Vercel, Resend, DNS or cron, so
   these stay owner-run by design and no amount of generated code closes them.

## 4. Standing constraints for any pack

- Free tier: one account, planning baseline, one lifetime sample day, one
  bounded sample adjustment, no payment method.
- Prices €9.99 monthly / €59.99 yearly and the refund policy are canonical.
- Every AI route safety-classifies before generation and fails closed. Blocked
  or crisis input never generates, never consumes entitlement, never upsells.
- Allergens and privacy are hard deterministic gates around model output; an
  LLM judge is never the sole safety or release gate.
- No streaks, scores, food morality, shame, fake scarcity or "unlimited".
- Adult general wellbeing only — never diagnosis, therapy, crisis counseling,
  eating-disorder recovery, restrictive dieting or disease/pregnancy nutrition.

## 5. Current verdict

**Not carried here.** The verdict lives in one place —
`docs/release/manifest.v11.json`, rendered for humans in
`docs/launch-go-no-go-v11.md` §6. Copying it into a second document is how the
v10 set ended up disagreeing with itself, so this section deliberately does not
restate it beyond the one line that matters:

- **Public paid launch: NO-GO.** One P0 and five P1 blockers are open — three
  owner-run (live transaction, reminder/cron/email rehearsal, key rotation and
  restore drill), three engineering (authenticated E2E at head, header
  accessibility, commercial copy).

Run `npm run release-manifest` to validate the manifest and the documents
against each other.
