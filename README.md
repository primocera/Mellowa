# Mellowa

A gentle daily wellbeing planner for adults with inconsistent routines. One
realistic plan for food, energy, mood and habits — adapted to how the day
actually feels. Not a diet app, macro tracker, therapy tool or medical
service.

## Update — v16 (2026-08-09)

**The path to launch is clean and the release loop is closed:**

1. **Freeze a candidate** — the automated gates are green (unit/contract/safety
   1500/1500) and the authenticated E2E matrix passed at candidate `a59aa4e`
   (93/0/27, seeded non-production Supabase, Stripe TEST mode). The P1 E2E gate
   is **closed** with committed artifacts.
2. **Open the capped beta** — beta needs no live charge; a bounded cohort keeps
   the blast radius small while the first real transactions come through.
3. **The live gate closes itself from real traffic** — real beta checkouts,
   cancels and refunds are `observed` production evidence, which closes
   `P0-LIVE-TRANSACTION` naturally. No manual re-rehearsing, and **no more Stripe
   code changes** — billing is frozen at v16 (the churn source is the fix).

`P0-LIVE-TRANSACTION` is an **owner-accepted risk** for public paid (carry-forward),
so future release packs must not re-open it or re-touch the billing path. See
[`docs/release/v16/OWNER-DECISION-BILLING-FROZEN.md`](docs/release/v16/OWNER-DECISION-BILLING-FROZEN.md)
and [`docs/release/manifest.v16.json`](docs/release/manifest.v16.json). Honest
readiness: capped beta gated only on cutting the candidate; public paid 7.9 with
the accepted P0. 9.5 also requires mature retention value, which only real usage
produces.

## Update — v13 (2026-08-03)

The **v13 launch-hardening pass** is merged to `main` (journal-reflection output
safety + usage lifecycle, Next 16.2.12 security patch with 0 production audit
vulns, release-truth consistency gate, adaptive-day metadata). Full record:
[`docs/release/v13/HANDOFF-v13.md`](docs/release/v13/HANDOFF-v13.md) and
[`docs/release/manifest.v13.json`](docs/release/manifest.v13.json).

**Pricing is now USD-first dual-currency** (not EUR-only). US/rest-of-world pay
**$12.99/mo · $129.99/yr**; EU/EEA buyers pay **€11.99/mo · €119.99/yr** on the
same Stripe price ids via `currency_options`, gated by `EUR_PRICING_ENABLED`.
Live-verified against Stripe 2026-08-03. See `src/lib/stripe/currency.ts` +
`docs/release/v13/HANDOFF-v13.md` §2.

Remaining gap to a clean beta **GO** (still CONDITIONAL below): run the
authenticated E2E matrix (`npm run test:e2e:matrix`) once at the pinned v13
candidate against a seeded non-production Supabase, then freeze the manifest.
The section below is the last frozen v12 record and is kept for history.

## Status — v12 candidate `745b4a4`, 2026-07-31

| Tier | Verdict |
| --- | --- |
| Automated code gate | **CONDITIONAL GO** |
| Capped private beta (≤50 invites) | **CONDITIONAL GO** |
| Unrestricted public paid launch | **CONDITIONAL GO** — signed, see below |

Live at **[mellowa.app](https://mellowa.app)**. The superseded RC `0025a502` has
been **re-cut** as `745b4a4`, which carries the whole v12 launch-hardening pass.
Every automated gate that runs without production secrets was re-run at this SHA:
lint clean, typecheck clean, **1234** unit/contract/safety tests, **81** eval,
build ✓, **75** public browser journeys (desktop / 375 / 320), warm-lab LCP
828/656/676 ms with CLS 0.

**`CONDITIONAL GO` is not `GO`.** One P0 and three P1s are still open, each
carrying the owner's standing `accepted_risk` (Primoz Cerar, 2026-07-28). An
acceptance never closes a blocker and can never produce a `GO`; deleting the
acceptances returns the tier to `NO-GO`, which
[`tests/release-manifest.test.ts`](tests/release-manifest.test.ts) asserts. v12
reduced several of these in code, but a code change does not close owner
evidence — the drills below are owner-run and the acceptances need re-confirming
before public paid scales.

Open and accepted (owner-run):

- `P0-LIVE-TRANSACTION` — charge, cancel, reactivate and refund were run **live**
  against the €9.99 plan on 2026-08-01; the residual (accepted) is a live
  payment failure→recovery and late-failure ordering (steps 5–6), covered in
  code by the order-resilient billing path (MW-V12-03) and its tests.
- `P1-REMINDER-REHEARSAL` — duplicate-cron and provider-failure not observed
  live; both have deterministic tests and a sharpened owner worksheet.
- `P1-ROTATION-RESTORE` — key rotation and restore never rehearsed; now scripted
  with a safe fingerprint check and an executable restore verification.
- `P1-AUTH-E2E-AT-HEAD` — the matrix runner is fail-closed and marker-guarded,
  but has not run unattended against a seeded env.

Migrations **040 and 041** were applied to the live project on 2026-08-01
(owner-attested). Still owner-run before launch: the production release-check
and cold-start + field vitals.

Full record: [`docs/launch-go-no-go-v11.md`](docs/launch-go-no-go-v11.md) ·
machine-readable:
[`docs/release/manifest.v11.json`](docs/release/manifest.v11.json) · v12 plan:
[`docs/release/v12/00-ORCHESTRATION-PLAN.md`](docs/release/v12/00-ORCHESTRATION-PLAN.md)

## Project state

**Before scoping new work, read [`docs/BUILD_STATE.md`](docs/BUILD_STATE.md).**
It is the canonical list of what is already built and tested versus what is
genuinely open, so new prompt packs stop re-commissioning shipped features. The
per-release `docs/launch-go-no-go-*.md` files are history; `BUILD_STATE.md` is
the current truth.

## Stack

Next.js App Router · TypeScript (strict) · Tailwind CSS · Supabase (Auth +
Postgres with RLS) · Anthropic API (plan generation with mandatory safety
classification) · Stripe Billing · Resend (transactional email) · Vercel.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm run test       # Vitest unit tests
npm run build
```

## Environment

Copy `.env.example` (or see below) into `.env.local`:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only admin access |
| `AI_PROVIDER_API_KEY` / `AI_PROVIDER_MODEL` | plan generation |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | billing |
| `STRIPE_PRICE_PRO_MONTHLY` / `STRIPE_PRICE_PRO_YEARLY` | price ids |
| `RESEND_API_KEY` / `EMAIL_FROM` | transactional email |
| `CRON_SECRET` / `ADMIN_STATS_SECRET` | cron/ops auth — **required in production** (fail-closed, see `docs/ops-cron.md`) |
| `NEXT_PUBLIC_APP_URL` | canonical URL |
| `LEGAL_ENTITY_NAME`, `LEGAL_REGISTERED_ADDRESS`, `LEGAL_GOVERNING_LAW`, `SUPPORT_EMAIL`, `PRIVACY_EMAIL` | legal identity (required for `LAUNCH_MODE=paid`) |
| `LAUNCH_MODE` | set to `paid` only when legal config is production-ready — startup refuses placeholders |

## Database

Migrations live in `supabase/migrations/` (apply in order in the Supabase SQL
editor or CLI). Every user-owned table must be registered in
`src/lib/privacy/registry.ts` — a contract test fails otherwise.

## Safety rules (non-negotiable)

Every AI generation route runs safety classification first (deterministic
pre-filter + AI classifier, failing closed). No medical/diagnostic advice, no
restrictive diets, no disease-specific meal plans, no crisis counseling —
crisis input gets region-aware support pointers and generation stops. See
`AGENTS.md` for the full product rules.

## Deployment (Vercel Hobby)

- Crons are daily-only on Hobby (`vercel.json`).
- `CRON_SECRET`/`ADMIN_STATS_SECRET` must be set or production refuses to boot.
- Timed reminder delivery uses Resend scheduled sending from the daily cron.
