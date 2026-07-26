# Build state — read this before writing the next prompt pack

**Purpose:** this is the single canonical answer to "what is already built and
what is actually open." It exists because prompt packs v8, v9 and v10 re-asked
for work that was already shipped. If you are scoping a new pack from the public
repo, read this file first — not the individual `launch-go-no-go-*.md` history.

**Last verified:** 2026-07-26 on branch `v10` through MW-V10-01 (baseline
`90f5482` = `main`). Automated suite: **621 tests / 74 files green**, lint clean
(0 errors), typecheck clean, production build clean.

**v10 progress:** MW-V10-00 ✅ · MW-V10-01 ✅ (copy reduction fell short of
target — see `launch-go-no-go-v10.md`) · MW-V10-02 … 08 not started.

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

Verified absent or partial in the code as of `90f5482`.

| # | Gap | Evidence it is open | Owner |
|---|---|---|---|
| 1 | **One real transaction end to end** (charge → cancel → reactivate → portal → refund) | No recorded evidence; `launch-go-no-go-v9.md` §4 blank | Owner (not Claude — live Stripe) |
| 2 | **Authenticated seeded E2E never run** | `e2e/journeys.spec.ts` exists but needs `E2E_TEST_USER_*`; CI job skips | Owner/CI |
| 3 | **Reminder / cron / email live rehearsal** | Planner is *tested*, never *rehearsed live* | Owner |
| 4 | **Key rotation + backup/rollback drill** | No runbook evidence recorded | Owner |
| 5 | `/api/health/ready` validates only migrations `020`/`021` | Reads `generation_requests` + `email_deliveries`; does not verify the `034`/`035` RPC overloads the app actually calls | Eng |
| 6 | **Trial-length experiment infrastructure absent** | `TRIAL_DAYS = 3` is a hardcoded constant in `src/lib/stripe/plans.ts`; no server-owned variant assignment | Eng |
| 7 | **Beta invite cap + stop-acquisition switch absent** | Zero matches for cap/invite/stop-switch in `src/`; the v9 funnel measures but cannot gate intake | Eng |
| 8 | Refund / dispute webhook events unhandled | `charge.refunded` and `charge.dispute.created` are not in the webhook switch | Eng |
| 9 | Ceiling-denial counting not instrumented | Admin scorecard shows 0 denials by construction | Eng (P2) |
| 10 | Public Lighthouse/perf never measured at an RC | No CI perf gate by project rule | Owner (P2) |
| 11 | No in-app reminder opt-out confirmation surface | Unsubscribe works from email (fixed in v10); Settings does not yet reflect "off because you unsubscribed" | Eng (P2) |

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

## 5. Current verdict (carried from `launch-go-no-go-v9.md`)

- Automated code gate: **GO** (618 tests green on `v10`).
- Capped private beta (≤50 invites, no card for the sample): **GO**.
- Public paid launch: **NO-GO** — blocked on gaps #1–#4, all owner-run.
