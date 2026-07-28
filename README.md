# Mellowa

A gentle daily wellbeing planner for adults with inconsistent routines. One
realistic plan for food, energy, mood and habits — adapted to how the day
actually feels. Not a diet app, macro tracker, therapy tool or medical
service.

## Status — v11, 2026-07-28

| Tier | Verdict |
| --- | --- |
| Automated code gate | **CONDITIONAL GO** |
| Capped private beta (≤50 invites) | **CONDITIONAL GO** |
| Unrestricted public paid launch | **CONDITIONAL GO** — signed, see below |

Live at **[mellowa.app](https://mellowa.app)**. 1126 unit tests across 92 files,
typecheck and lint clean.

**`CONDITIONAL GO` is not `GO`.** One P0 and three P1s are still open, each
carrying a recorded `accepted_risk` — a named person, a date, the tier it
covers, and a rationale stating what is unverified and what happens if it is
wrong. An acceptance never closes a blocker and can never produce a `GO`;
deleting the acceptances returns the tier to `NO-GO` on its own, which
[`tests/release-manifest.test.ts`](tests/release-manifest.test.ts) asserts.

Open and accepted:

- `P0-LIVE-TRANSACTION` — no charge captured or refunded against the live
  €9.99 plan. Mitigated only by cohort size.
- `P1-REMINDER-REHEARSAL` — 5 of 7 items evidenced live; duplicate cron run and
  deliberate provider failure untested.
- `P1-ROTATION-RESTORE` — key rotation and restore never rehearsed; recovery
  time unmeasured.
- `P1-AUTH-E2E-AT-HEAD` — matrix passes, but never in one unattended sweep.

Closed on evidence: `P0-PRICE-CURRENCY` — live prices verified at
`999 eur/month` and `5999 eur/year`
([evidence](docs/release/evidence/v11/rc/verify-prices.txt)).

Full record: [`docs/launch-go-no-go-v11.md`](docs/launch-go-no-go-v11.md) ·
machine-readable: [`docs/release/manifest.v11.json`](docs/release/manifest.v11.json)

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
