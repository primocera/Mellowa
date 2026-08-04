# Mellowa v13 — handoff for the next prompt-pack author

> **SUPERSEDED (2026-08-04, MW-06).** The v13 RC `940cb94` is superseded by later
> product code (USD-first pricing + EUR options, migration 042, and the
> branch-`v14` MW-02..MW-06 hardening). Any v13 launch verdict is now UNASSESSED
> pending a new candidate (MW-09); see `manifest.v13.json`.

Written 2026-08-03. Everything below is **done and on `main`** unless marked
BLOCKED/OWNER. Use this to know what NOT to re-commission and where the open
threads are. Candidate: the v13 work sits on `main` past the v12 base `74080e0`.

## 1. The v13 launch-hardening pack (Mellowa_Master_Prompt_Pack_v13)

All 12 prompts executed, one focused commit each, gates re-run at the candidate.

| Prompt | What shipped | Status |
| --- | --- | --- |
| **MW-P0-01/02** | journal-reflection route now runs `checkJournalReflectionOutput` with **one corrective retry then fails closed**; every reserved AI usage event reaches one terminal state (success / safety_blocked / provider_error finalize, or `releaseReservation`); no journal text in the ledger. New `tests/journal-reflection-route.test.ts` (9 route-level tests with the real guard). | DONE |
| **MW-P0-03** | `next` + `eslint-config-next` **16.2.10 → 16.2.12**; `overrides` for `sharp ^0.35.3` + `postcss ^8.5.25`. **Production `npm audit` = 0 vulnerabilities.** New `tests/protected-route-auth.test.ts` proves `requireUser` redirects server-side independent of the proxy. See `docs/security-next-advisories-v13.md`. | DONE |
| **MW-P0-04** | Reconciled the v12 release-truth contradictions (invalid "CLOSED via accepted risk", migration applied-vs-pending, live-money claims). New `tests/release-truth-consistency.test.ts` = a doc↔manifest gate that fails CI on any reintroduced contradiction (verified against an injected one). | DONE |
| **MW-P1-05** | Authenticated E2E matrix — tooling exists + green; the run needs a **seeded non-prod Supabase + Stripe test mode**. `docs/release/v13/MW-P1-05-status.md`. Flags one gap: no journal-reflection *authenticated* journey yet (only route-level). | BLOCKED (owner) |
| **MW-P1-06** | Consolidated owner-only production rehearsal runbook. `docs/release/v13/MW-P1-06-owner-rehearsal.md`. | DONE (doc) |
| **MW-P1-07** | Shared-Stripe isolation decision record + safe phase-1 (tests/config only). `docs/release/v13/MW-P1-07-stripe-isolation-decision.md`. | DONE (doc) |
| **MW-P1-08** | Root metadata + PWA manifest standardized to the adaptive-day wedge (retired the generic "simple daily plan" line). Contract test in `tests/seo-pwa.test.ts`. | DONE |
| **MW-P1-09** | Adaptive-day analytics + scorecard were already built (v8–v12); recorded the event mapping so it's not rebuilt. `docs/release/v13/MW-P1-09-status.md`. | ALREADY DONE |
| **MW-P1-10** | New `docs/runbooks/ai-usage-health-queries.sql` (stuck-reserved detection etc.) + monitoring-alerts wiring tied to MW-P0-01. | DONE |
| **MW-P2-11** | Cold-start/field perf tooling ready; needs a deployed preview + ≥100 field samples. `docs/release/v13/MW-P2-11-status.md`. | BLOCKED (owner) |
| **MW-FINAL** | `docs/release/manifest.v13.json` (draft candidate) + `docs/release/v13/MW-FINAL-signoff.md`. All tiers **CONDITIONAL GO**. | DONE |

**Gates at the candidate:** lint 0 errors, typecheck clean, `npm audit --omit=dev` 0 vulns, vitest full suite green, eval 81/81, build ✓, public E2E 75/75.

## 2. Pricing reversal — USD-first dual currency (NOT in the v13 pack; owner-driven)

**The big correction:** Mellowa was mis-framed as EUR-only in v11. It is **USD-first**
(primary market USA). It now charges **USD by default, EUR for EU/EEA buyers**,
Scalvya-style. **Live-verified working on 2026-08-03** (owner from EU sees €11.99).

- **Model: ONE Stripe price id per interval, USD + EUR `currency_options`** (not
  two separate ids). Checkout passes `currency` on the same id; Stripe charges
  the matching option. This was the key clarification — an earlier assumption of
  two separate ids was wrong and reworked.
- **Amounts (fixed, no live FX):** monthly **$12.99 / €11.99**, yearly **$129.99 / €119.99**.
- **Gated by `EUR_PRICING_ENABLED`** (env). Off ⇒ USD-only (safe default). On ⇒
  EU/EEA → EUR. Region from `x-vercel-ip-country`.
- **Live Stripe state:** monthly `price_1U0JIN0YzvSNMCpNVpRGLRKV`, yearly
  `price_1U0JN80YzvSNMCpNbKX09MXH`; both carry USD + EUR currency_options
  (added via `scripts/add-eur-currency.mjs`). Old $9.99/€9.99/€59.99 prices
  archived. Account settles in EUR. `EUR_PRICING_ENABLED=1`. `verify-prices` LIVE = all OK.

**Key files (all on `main`):**
- `src/lib/stripe/currency.ts` — region→currency, EU/EEA set, `EUR_PRICING_ENABLED` gate, `x-vercel-ip-country`.
- `src/lib/stripe/currency-server.ts` — `serverCurrency()` for RSC pages (`headers()`).
- `src/lib/stripe/price-resolver.ts` — `resolvePrice(interval, currency)` (single id + currency) and **`planFromPriceId()`** (fixes a webhook bug: it previously only matched legacy ids).
- `src/lib/stripe/plans.ts` — `CATALOG`, `pricingFor(currency)`, `priceDisplay()`, per-currency `BILLING_CONTRACT`.
- `src/app/api/stripe/checkout/route.ts` — passes `currency` on the session; currency in the idempotency key.
- `src/app/api/stripe/webhook/route.ts` — stores `subscription.currency` on the row.
- `src/app/api/cron/trial-reminders/route.ts` — trial email uses the buyer's real currency.
- `src/app/api/admin/readiness/route.ts` — **PUBLIC** JSON view of pricing wiring (no secrets).
- `scripts/verify-stripe-prices.mjs` — checks USD base + EUR currency_option per price.
- `scripts/add-eur-currency.mjs` — owner-run: attach EUR currency_option to existing prices (read-only-safe until applied; never touches USD base).
- `supabase/migrations/042_mellowa_v13_subscription_currency.sql` — adds `subscriptions.currency` (applied).
- Display surfaces updated: `src/app/pricing/page.tsx`, `src/app/page.tsx` (incl. JSON-LD), `src/app/(app)/billing/page.tsx`.
- Tests: `tests/currency-pricing.test.ts`, updated `tests/billing-contract.test.ts`.

## 3. Still open (owner-run, not code) — candidate stays CONDITIONAL GO

- `P1-AUTH-E2E-AT-HEAD` — run the authenticated matrix once at the v13 candidate against a seeded non-prod Supabase; **add a journal-reflection authenticated journey** while there.
- `P0-LIVE-TRANSACTION` — steps 1–4 done live 2026-08-01; **steps 5–6** (live payment failure→recovery + late-failure ordering) still need a test clock. Accepted risk.
- `P1-REMINDER-REHEARSAL`, `P1-ROTATION-RESTORE` — owner drills (scripted, not run). Accepted risks.
- `P2-COLD-START`, `P2-INP-UNMEASURED` — deployed-preview perf + ≥100 field samples.
- Freeze the v13 manifest (`candidateLifecycle: draft → frozen`) once the above are addressed.

## 4. Suggested threads for the next pack

- A journal-reflection **authenticated** E2E journey (free/premium/safety-blocked) — the one coverage gap MW-P1-05 named.
- Option A of the Stripe isolation plan (separate account) once the paid cohort grows — see MW-P1-07.
- Trial-reminder currency is now correct; the **billing page** still uses geo currency rather than the subscription's stored `currency` — minor refinement if a traveling subscriber matters.
- EU yearly is live (€119.99); if more currencies/regions are ever wanted, extend `CATALOG` + the EU/EEA set + add currency_options.

## Rules that still hold
- No CI/GitHub Actions (spam). Local `typecheck` + Vercel build are the validation.
- Prompt-pack `.docx` files never go in git.
- Owner runs migrations + all live/production actions; Claude never does live billing/keys/migrations without explicit approval.
