# Mellowa — Beta v14: CONDITIONAL GO (capped beta, ≤50)

**Formal verdict: `capped_beta` = CONDITIONAL GO** (via accepted risk, see below).
**`public_paid` = NO-GO** (live-billing / rotation / reminder blockers still open).
As of **2026-08-04**. Live at **https://mellowa.app**. `main` @ `cfa2064`+.

> **Read this before writing any v15 prompts.** The v14 work below is **done,
> shipped, and validated in production** — do not generate prompts to re-do it.
> Only propose *net-new* work for v15.

## Formal go/no-go (accepted risk)

`capped_beta`'s only blocker is **`P1-AUTH-E2E-AT-HEAD`** — the unattended
authenticated E2E matrix has never run (no disposable non-prod Supabase target;
it is never run against production). It is **accepted, not met**, so the beta is
**CONDITIONAL GO — never a clean GO** — and this must be **cleared, not carried**,
before any public/paid expansion.

```json
{
  "blockerId": "P1-AUTH-E2E-AT-HEAD",
  "acceptedBy": "Primoz Cerar",
  "acceptedOnUtc": "2026-08-04T00:00:00Z",
  "tiers": ["capped_beta"],
  "rationale": "The unattended authenticated E2E matrix has not run at this SHA because no disposable non-production Supabase target exists, and it is never run against production. It is accepted for the capped beta only because the same authenticated journeys — signup, onboarding, sample plan, full plan, whole-day adjust with free Undo, checkout, trial disclosure, billing and a live EUR charge — were exercised by hand against mellowa.app at this SHA on 2026-08-04 and passed, and the deterministic safety, entitlement and fail-closed paths they cover are unit-tested (1364 vitest, 75 public E2E, eval suite, build). Residual unknowns are the journal-reflection entitlement/safety journey and cross-account isolation under the automated sweep; the beta is invite-only and capped at 50, which bounds exposure. To be cleared, not carried, before any public or paid expansion by standing up a seeded non-prod Supabase and running npm run test:e2e:matrix at the release SHA."
}
```

**Not yet in the machine-validated manifest.** `manifest.v13.json` is superseded
(MW-06) and no v14 RC manifest was cut (MW-09, owner-gated). The record above is
the owner's accepted-risk decision in prose; cutting `manifest.v14.json` at
`cfa2064` — carrying this accepted risk, the suite results, and owner evidence —
is the remaining formal step to make it machine-checked.

---

## Beta launch checklist — COMPLETE

| # | Step | Status |
|---|------|--------|
| 1 | Merge v14 → main (deploy) | ✅ pushed, fast-forward to `4d63d21`, then fixes below |
| 2 | Run migration `042` in prod Supabase | ✅ done (in v13) |
| 3 | Verify live Stripe prices | ✅ USD + EUR `currency_options` + product ownership |
| 4 | EUR pricing gate | ✅ `EUR_PRICING_ENABLED=1` + `EUR_PRICING_VERIFIED=1`; `/api/admin/readiness` → `ok:true` |
| 5 | Smoke test on mellowa.app | ✅ see below |
| 6 | Invite ≤50, invite-only | owner action (code/infra is ready) |

## Stripe / pricing — verified LIVE

- Model B (one price id per interval + `currency_options`), **USD-primary, EUR region**.
- USD `$12.99`/mo, `$129.99`/yr · EUR `€11.99`/mo, `€119.99`/yr.
- **Product ownership** now enforced: both products tagged Stripe metadata
  `app=mellowa` (shared Stripe account across apps). `verify-prices` = all OK.
- **EU account was charged in EUR end-to-end** (confirmed by owner on a real
  Premium account). Non-EU / anonymous visitor is quoted USD.

## Smoke test — validated in production

| Path | Result |
|------|--------|
| Signup → onboarding → free sample plan | ✅ |
| Severe/life-threatening allergy → plan generates **without meals** (rest of day kept) | ✅ |
| Full plan (meals + movement + calm reset + hydration + evening + habit) | ✅ |
| Adjust the rest of today (Premium) — reshapes remaining, keeps done/kept items | ✅ dishes DO change (e.g. "Meals don't work" swaps meals); a lighter/context reason keeps the same dishes but simplifies them, by design |
| Undo — free, no AI generation | ✅ |
| Free/sample user sees Premium prompt up front (no dead paywall) | ✅ |
| Checkout / trial disclosure / billing | ✅ |
| EUR charge on EU Premium account | ✅ |

## Bugs found by the smoke test and FIXED this cycle (all live)

1. **Severe-allergy daily plan blocked the whole plan.** The daily-plan route
   returned `blocked:true` before generating anything, so a severe-allergy user
   got *no plan at all* — while the copy promised "everything else is still
   here." Now meals are stripped **deterministically after generation**
   (fail-closed; no meal can reach the user even if the model ignores the
   prompt) and the non-meal sections are kept. Meal-only routes (meal-rhythm,
   weekly-plan, low-energy-day, favourite-meal) keep the full block.
   `68369e0`.
2. **Adjust didn't visibly update meals/movement (Premium).** Those two sections
   were held in local React state seeded at mount, so a post-adjust
   `router.refresh()` left them stale while every prop-rendered section updated —
   the plan looked unchanged. Now re-synced on new plan version. `7ff9396`.
3. **Free/sample users could commit a whole-day Adjust into a 402 paywall.**
   `plan-repair` is `requirePremium: true`. The Today page now receives the
   user's tier (fail-closed) and shows the Premium prompt up front instead of
   the sheet. `75255e5`.
4. **"Finish onboarding" error gave no path.** Now points to
   You → Plan preferences → Start onboarding. `75255e5`.
5. **CI was red on every push (and emailing the owner).** `ci.yml` returned; the
   `release-manifest` test does `git diff <frozen-RC>..HEAD`, but
   `actions/checkout@v4` is a shallow clone → "bad object". Fixed with
   `fetch-depth: 0`. `bebe004`.
6. **Two stale tests** surfaced once CI could run to completion:
   `checkin-copy.test.ts` (asserted old copy) and `e2e/public.spec.ts` (asserted
   the removed `€9.99/€59.99` prices — now `$12.99/$129.99` USD-primary).
   `00ba7f5`, `cfa2064`.

**CI is GREEN** on `cfa2064` (both jobs). Gates: typecheck ✓, vitest **1364** ✓,
build ✓, public E2E **75/0** ✓.

> Note: **Vercel deploys are independent of GitHub Actions.** The app deployed
> fine the entire time CI was red — GitHub's status line read "Deployment has
> completed." Do not treat a red CI check as "prod is broken."

## NOT exhaustively tested (NOT launch-blocking for an invite-only beta)

These secondary Premium features were **not** click-tested this cycle. They are
lower risk; the invite-only beta is the appropriate place to surface any issue.
If v15 wants to harden anything, this is the honest list — but it is **polish,
not a redo of the above**:

- **Week at a glance** (weekly plan) — AI generation; smoke locally
- **Meal rhythm** — AI generation; smoke locally
- **Shopping list** — derived from weekly/meals
- **Saved meals**, **Meal ideas** — save/reuse (CRUD)
- **Movement**, **Resets** — curated library (no AI), lowest risk

(Weekly plan and Meal rhythm are correctly **fully blocked** for severe-allergy
accounts — test on a non-allergy Premium account.)

## Known-small, non-blocking follow-ups (optional)

- **"Changed" badge on adjusted cards.** After an adjust, the "Rest of today
  adjusted" banner names what changed, but the cards themselves don't flag it,
  so subtle changes (reworded description, shorter prep time) are hard to spot.
  A per-card "changed" marker would make it obvious. Not built.
- **`ci.yml` exists again** despite the historical "no CI" preference. It is
  green now (so no more failure-mail spam) and it caught two real stale tests,
  so it is currently earning its keep. Remove only if the no-CI policy is
  reaffirmed.

## For the v15 author (do not redo)

Everything in "COMPLETE", "verified LIVE", "validated", and "FIXED" above is
**done and in production**. v15 should be **net-new** scope only (or the optional
polish in the two lists above). Re-prompting the shipped v14 work would waste
generations on a beta that is already live.
