# Mellowa

> **Next prompt pack?** The engineering build (v6–v19) is done and certified. The
> project is now moving toward marketing — the next pack is the **v20 "Moving Toward
> Marketing" pack**, not engineering. Read [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md)
> **first.** Coding stays open for real fixes; just don't write another engineering
> pack by default.

A gentle daily wellbeing planner for adults with inconsistent routines. One
realistic plan for food, energy, mood and habits — adapted to how the day
actually feels. Not a diet app, macro tracker, therapy tool or medical
service.

## Release status

Release truth is **machine-generated**, not hand-written here — so this section
carries no verdicts, counts or SHAs that could drift:

- Machine manifest: [`docs/release/manifest.v16.json`](docs/release/manifest.v16.json)
- Rendered status (generated from the manifest; a contract test fails on drift):
  [`docs/release/v16/STATUS.md`](docs/release/v16/STATUS.md)
- Candidate lifecycle & freeze/promote sequence:
  [`docs/release/v17/RC-LIFECYCLE.md`](docs/release/v17/RC-LIFECYCLE.md)
- Latest record (current line): [`docs/release/manifest.v22.json`](docs/release/manifest.v22.json)
  and its certification
  [`docs/release/v22/MELLOWA-FINAL-CLOSURE-CERTIFICATION.md`](docs/release/v22/MELLOWA-FINAL-CLOSURE-CERTIFICATION.md)
  (with [`EVIDENCE.md`](docs/release/v22/EVIDENCE.md)) — the current RC, verdicts and
  owner-evidence state live there, not restated here. The rendered status above
  stays pinned to the last promoted line (v16).

At the current HEAD the candidate is a **draft**: no SHA is frozen, so all three
verdicts are **UNASSESSED** until a candidate is cut via the immutable
release-candidate workflow. **The release loop is not closed — do not read a GO
here.** `P0-LIVE-TRANSACTION` is an owner-accepted risk for public paid
(carry-forward); billing code is frozen at v16 apart from fail-closed
failure-path fixes. See
[`docs/release/manifest.v16.json`](docs/release/manifest.v16.json).

Dependency posture: `npm audit --omit=dev` reports **0** high/critical — see
[`docs/release/evidence/v17/dependency-audit.md`](docs/release/evidence/v17/dependency-audit.md),
which also tracks one dev-only advisory in the open.

Pricing is USD-first dual-currency (USD everywhere, an EUR region price for
EU/EEA on the same price ids via `currency_options`, gated by
`EUR_PRICING_ENABLED`); the one catalog is `src/lib/stripe/plans.ts`.

### Release history (archived — not current)

Per-release snapshots for v11–v16 live under `docs/release/` and the
`docs/launch-go-no-go-*.md` files. They describe the state **at their time** and
are superseded by the generated status above — do not read them as current
instructions or current verdicts.

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
