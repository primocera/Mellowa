# XAPP-V12-01 — cross-app isolation review (Mellowa side)

**Scope.** This repo is `primocera/Mellowa` only. The Scalvya/LaunchBloom side
and the *live* cross-app pairing (a real Scalvya event delivered to Mellowa's
production endpoint and vice-versa) are owner-run in `primocera/LaunchBloom`.
This is the read-only-first Mellowa half at frozen candidate `745b4a4`; the only
changes made are a regression test and this document, so the candidate is **not**
invalidated.

## Checks (Mellowa side)

| # | Area | Mellowa status | Enforced by |
|---|---|---|---|
| 1 | **Stripe — foreign events** | PASS | Subscription events without `supabase_user_id` and no matching stored customer are acked as `{ ignored: true }`; every `syncSubscription` call site is guarded. Invoice handlers read the subscriptions row first, so a foreign customer triggers no mutation, email or analytics (MW-V12-03). Foreign refunds/disputes resolve to a user before recording. Idempotency keys on the account-global Stripe `event.id`, so no cross-product collision. |
| 2 | **Email — sender & unsubscribe** | PASS | Sends from `serverEnv.emailFrom` (per-app `EMAIL_FROM`), never a hardcoded brand. One-click unsubscribe is HMAC-signed with `EMAIL_UNSUBSCRIBE_SECRET` (per-app), so a token minted by another app cannot verify here and suppression cannot cross brands. Transactional vs optional split is total (`EMAIL_CATEGORIES`), so a foreign event cannot trigger a Mellowa transactional message. |
| 3 | **Auth / Supabase** | PASS | Callback redirects only to allow-listed relative paths (`sanitizeNextPath`) resolved against the request's own `url.origin` — it cannot be steered to another app or to production. Each app has its own Supabase project; the E2E seed is marker-guarded (MW-V12-02) so it cannot target production or another app's DB. |
| 4 | **Analytics** | PASS | Events are validated against a closed enum + allowlisted property keys (`taxonomy.ts`); no free-text or wellbeing content is stored. Each app writes to its own `app_events` in its own project, so namespaces cannot collide; `build_id` on field vitals separates deploys. |
| 5 | **Production configuration** | PASS (owner to confirm live) | `release-check` and `verify-prices` validate Mellowa's own domains, EUR prices and provider config and print presence only, never a value; `secret-fingerprint.mjs` confirms identity without printing. The live confirmation is owner-run. |
| 6 | **Commercial content** | PASS | Price, currency (EUR), renewal and cancellation wording come from Mellowa's own `BILLING_CONTRACT`/`PRICING` and are pinned to Stripe by `verify-prices`; the Premium value contract (MW-V12-06) is Mellowa's own audience. No Scalvya claims or audience are inherited. |
| 7 | **Release truth** | PASS | Evidence is pinned to this repo and candidate `745b4a4`; accepted risks produce CONDITIONAL GO, never full GO; the superseded `0025a502` record is labelled and never presented as current. |

Regression coverage: `tests/cross-app-isolation.test.ts` (the Scalvya→Mellowa
half — a foreign event acknowledged without side effects), plus
`tests/webhook-isolation.test.ts` and `tests/billing-lifecycle-order.test.ts`.

## Final report

| | Scalvya | Mellowa |
|---|---|---|
| Isolation review | **Owner-run in LaunchBloom** (not in this repo) | **PASS** at `745b4a4` |
| Candidate | LaunchBloom's own | `745b4a4`, frozen, CONDITIONAL GO |

**Shared risks (both apps, owner-run):** the *live* cross-app pairing is not yet
observed — a real Scalvya Stripe event delivered to Mellowa's production webhook,
and the reverse, each confirmed to produce no side effect in the other. The code
guards are in place and unit-tested on the Mellowa side; the live confirmation
needs both production endpoints and belongs with the owner. The single shared
Stripe/Resend account remains the structural risk both apps carry until each has
its own account.

**Owner-only actions:** run the live cross-app event pairing in both directions;
confirm per-app production config (`release-check`, `verify-prices`,
`secret-fingerprint`) for each app; freeze LaunchBloom's candidate and run its
half of this review.

**May paid acquisition expand?** **Not on technical isolation alone.** Mellowa's
isolation is verified in code and its candidate is CONDITIONAL GO, but public
paid still depends on the owner-run drills (live transaction, rotation/restore,
authenticated matrix) and on proven day-2/day-3/week-2 recurring value from the
beta scorecard, which has no data yet. Expansion stays **BLOCKED** by default
until that data exists.
