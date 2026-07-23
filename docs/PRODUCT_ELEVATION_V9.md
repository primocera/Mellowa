# Product Elevation v9 — frozen baseline and plan

**Written by:** MW-V9-00 (baseline freeze).
**Baseline commit (main):** `1417579532d25136269b1329aa94c7e8d5c149e5` — identical
to the reviewed baseline in the v9 prompt pack. **Drift from reviewed baseline: none.**
Work branch: `v9`.

Status vocabulary used in every v9 document: **configured** (set up, not
exercised) · **deployed** (live code/config) · **rehearsed live** (a human ran
the real action once and recorded evidence) · **observed over time** (behaviour
seen repeatedly in production). "Production-ready" is never used as shorthand.

---

## 1. Baseline facts (verified in-repo at the frozen commit)

- Migrations present: `001`–`033`. `027`–`033` (v8) are **applied to live
  Supabase** per `docs/launch-go-no-go-v8.md` (operator, 2026-07-21) —
  configured/deployed, with live confirmation via `/api/health/ready` still to
  be re-checked by the owner.
- Live Stripe: keys, webhook, EUR prices €9.99/€59.99 **configured** 2026-07-21.
  **No real transaction has been rehearsed live** — this is the open P0.
- Cron pingers **configured** (cron-job.org ×3 + 2 Vercel crons); run-history
  success **not yet observed over time**.
- No CI existed at baseline (no `.github/workflows`). Added by MW-V9-00.
- Test suite at baseline: full Vitest suite green locally (see go/no-go v8);
  authenticated Playwright E2E requires a seeded user env and is **explicitly
  non-green** until run for an RC.
- Privacy registry (`src/lib/privacy/registry.ts`) covers all user-owned
  tables through migration 033; `tests/privacy-registry.test.ts` enforces
  registration of any new table.
- Feature kill switches: `FLAG_PLAN_REPAIR`, `FLAG_WEEKLY_REFLECTION` (+ v6
  flags) in `src/lib/flags.ts`.

## 2. Route → job → sensitive data → entitlement → safety gate → value moment

### Public
| Route | User job | Sensitive data | Entitlement | Safety gate | Value moment |
|---|---|---|---|---|---|
| `/` landing | understand product, start sample | none | anonymous | content contract tests | promise + sample preview |
| `/pricing` | compare plans | none | anonymous | canonical PRICING only | clear €9.99/€59.99 + trial terms |
| `/privacy` `/terms` `/refund` | trust/legal | none | anonymous | legal-config tests | boundaries stated |
| `/auth/*`, `(auth)` | sign up / log in | email | anonymous | Supabase auth | account created |

### Authenticated (`(app)`) — v9 target IA: Today / Week / Saved / You
| Route | User job | Sensitive data | Entitlement | Safety gate | Value moment |
|---|---|---|---|---|---|
| `/today` | see one next step (Now), full plan | check-in signals, plan | free sample or Premium generation | safety classification before any generation | **Now card = core daily value** |
| `/check-in` | 1-minute daily input | energy/stress/mood, notes | free: 1 lifetime sample; Premium: daily | classifier fail-closed; crisis stops generation | plan created |
| `/plan` | view/repair daily plan | plan content | repair = Premium; sample adjustment = 1 lifetime | classifier + allergen + output guards; atomic RPC + Undo | rescue of a changed day |
| `/weekly-plan` | plan the week, shopping | meals, allergens, pantry | Premium | allergen revalidation at every reuse | continuity + shopping draft |
| `/favourites`, `/library`, `/meal-rhythm` | reuse saved things | favourites metadata | read: all; generate: Premium | allergen revalidation | reuse of what works |
| `/journal` | private notes | free text (never monitored) | all | never analyzed/AI'd | private record |
| `/progress`, `/habits`, `/movement`, `/stress-reset` | review recorded facts / small actions | logs | all | facts only, no inference | gentle continuity |
| `/you`, `/settings` | preferences, transparent memory, reminders, privacy | learned signals, consents | all | suppression boundaries; consent-versioned reminders | control + trust |
| `/billing` | subscribe/manage | subscription state | server entitlement | Stripe webhook = source of truth | pay/cancel/reactivate |
| `/onboarding` | baseline profile | allergies, preferences | all | severe-allergy handling | first plan possible |

### API surfaces (guards)
All `/api/ai/*` routes: safety classification **before** generation, fail
closed; entitlement + rate limit + idempotency (`generation_requests`); usage
ledger. `/api/stripe/*`: signature-verified webhook, ordered events,
reconciliation cron. `/api/cron/*`: bearer `CRON_SECRET`. `/api/admin/*`:
secret + allowlist, audited. `/api/account/export|delete`: registry-driven.

## 3. P0 / P1 / P2 at v9 start

| Sev | Item | Type | Owner |
|---|---|---|---|
| P0 | Live transaction rehearsal (charge → webhook entitlement → cancel → reactivate → portal → refund) never executed | **owner/live** | Primoz — `docs/runbooks/live-transaction-rehearsal.md` |
| P1 | Authenticated Playwright E2E not run (needs seeded staging user) | code+env | Primoz (env) / v9 (keep env-aware, non-green) |
| P1 | Health/uptime monitoring not configured | owner/provider | Primoz |
| P1 | `SUPABASE_SERVICE_ROLE_KEY` rotation drill pending | owner/provider | Primoz |
| P1 | Binary PWA PNG icons 192/512 missing | code | MW-V9-09 |
| P1 | Counsel/DPA review | owner/legal | Primoz |
| P2 | Error-reporting SDK (Sentry or equivalent) | code/ops | post-v9 |
| P2 | Cron run-history observed over time | owner | Primoz |

No additional baseline P0 **code** defects were found during the MW-V9-00
audit: safety classification precedes every AI route, entitlements are
server-side, privacy registry is complete through 033, and repair is atomic
with Undo. The open P0 is an owner-run live action, not code.

## 4. Rollout order (one prompt = one commit, each behind existing flags where behaviour changes)

| Phase | Prompts | Gate to proceed |
|---|---|---|
| 0 Freeze/P0 | MW-V9-00 | this document; go/no-go gate hardened; CI added; rehearsal checklist ready |
| 1 Core UX | MW-V9-01 → 05 | one daily job clear; no lost work; a11y green |
| 2 Paid value | MW-V9-06 → 08 | continuity + coherent commercial story |
| 3 Quality/scale | MW-V9-09 → 11 | measured beta, costs, rollback evidence |
| 4 Release | MW-V9-12 | frozen RC + honest go/no-go verdict |

## 5. Code tasks vs owner/legal/provider actions

**Code (Claude, this branch):** everything in MW-V9-01..12 that edits the repo;
fixtures for all automated coverage; checklists and templates for live actions.

**Owner-only (never executed from Claude Code):** applying migrations to live
Supabase; any Stripe/Vercel/Resend/cron-provider mutation; the live
transaction rehearsal; key rotation; DNS/monitoring signup; counsel/DPA;
signing the go/no-go verdict.
