# v19 Final Elevation — Current-HEAD Baseline (Prompt 00)

**Repository:** primocera/Mellowa (this working copy; `mellowa.app`)
**Branch:** `v19` (cut from `main`)
**HEAD SHA:** `0e4fec73aabd40e6e676e60ac5e40170a28669bf`
**Baseline captured (UTC):** 2026-08-15T10:51Z
**Working tree at capture:** clean except two untracked, non-product files
(`scratch_v19.txt` scratch extract, `docs/release/evidence/v13/auth-matrix/3fa516205e9b3d46866e12a6166276d3e8d79f3b.json`).

> This document records a trustworthy before-state for the v19 pack. **No
> application behavior was changed while writing it.** The v19 pack targets two
> repositories (Scalvya / LaunchBloom and Mellowa); **only the Mellowa prompts
> apply to this repo**: `00, MW-01–MW-14, XAPP-01, XAPP-02, XAPP-03, FINAL-01`.
> The `LB-01…LB-07` prompts belong to `primocera/LaunchBloom` and are out of
> scope here.

## 1. History reconciliation (important)

`main` HEAD (`0e4fec7`) **already contains all of v18**. The commits whose
messages say "release(v16)" (`0e4fec7`, `e40737b`, …) are actually the
post‑v18 authenticated‑E2E stabilization work layered on top of the v18 merge
commit `3fa5162` ("docs(handoff): v18 shipped"). Verified:
`git merge-base --is-ancestor 3fa5162 HEAD` → true; `git rev-list --count HEAD..v18` → 0.
So v19 builds on the full v15+v17+v18 line, not on a pre‑v18 state.

## 2. Baseline quality gate (ordinary, non‑secret)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` | **pass** (exit 0) |
| Unit / contract / safety | `npx vitest run` | **156 files, 1861 tests, 0 fail, 0 skip** (91.3s) |

Not run in this baseline (require build env / secrets / browser / owner env — deferred to the prompts that touch them, unchanged here): `npm run lint`, `npm run build`, `test:e2e:public`, `test:e2e:matrix`, `eval`, `release-check`.

## 3. Release truth (active)

- Active manifest: **`docs/release/manifest.v16.json`** — `candidateLifecycle: draft`, `rcSha: null`, migrations `001…048`.
- Required suites: lint/typecheck/unit/eval/build/e2e-public = `not_run` (only frozen at an immutable RC); `e2e-authenticated` = `blocked`; `release-check` = `blocked` (fails closed w/o prod env).
- Owner evidence: `authenticated-e2e-matrix` = **local_pass** at `e40737b` (93/0/27, disposable Supabase, Stripe TEST); `live-transaction` = **not_run**.
- Open blocker: **P0-LIVE-TRANSACTION** (blocks `public_paid`) — **owner-accepted risk**, carry forward per manifest `acceptedRisks`. **Stripe/billing is FROZEN at v16**; v19 does not re-open the live gate or change Stripe prices/catalog.
- Closed blocker: **P1-AUTH-E2E-AT-HEAD** (closed at `e40737b`). HEAD is one CI‑only commit (`0e4fec7`) beyond that; any product-code change in v19 invalidates the auth evidence and requires a fresh RC (MW-01).
- Verdicts: all `UNASSESSED`.

## 4. Central v19 finding: v18 modules are test-only contracts

The recurring theme of the v19 Mellowa prompts is that key v18 modules exist and
are unit-tested but have **no production caller** yet. Confirmed for the first:
`src/lib/today/plan-day.ts` is referenced **only** by `tests/plan-day.test.ts`
(zero production imports). The prompts below each wire one such module into a
real path. Per-module wired-vs-test-only status is re-verified at the start of
each prompt (never assumed) before any change.

| Module | Prompt | To be wired into |
|--------|--------|------------------|
| `today/plan-day.ts` | MW-02 | daily-plan route, Today page, complete/repair/regenerate APIs |
| `weekly/window.ts` | MW-03 | Week page + `api/week/reflection` |
| `feedback/preferences.ts` | MW-07 | daily + weekly generation, personalization, data controls |
| `today/first-session.ts` | MW-08 | canonical analytics report + first-session UX |
| `experiments/*`, `paywall/gating.ts`, `pricing/discovery-gate.ts` | MW-09 | product/admin flows (no Stripe price change) |
| `email/lifecycle-catalog.ts` | MW-12 | email delivery pipeline |
| `observability/slo.ts`, `perf/budget.ts` | MW-13 | production telemetry callers + readiness |

## 5. Task-relevant route map (for MW prompts)

Daily/plan: `api/ai/daily-plan`, `api/plan/complete`, `api/plan/feedback`, `api/ai/plan-repair`, `api/ai/regenerate-section`, `(app)/today`, `(app)/plan`.
Weekly: `api/ai/weekly-plan`, `api/week/reflection`, `(app)/weekly-plan`.
Readiness/ops: `api/admin/readiness`, `api/health`, `api/health/ready`, `api/cron/{account-deletion,email-outbox,retention,billing-reconcile,daily-reminders,trial-reminders}`, `api/account/{delete,deletion-status,export}`.
Growth/analytics: `api/events`, `api/vitals`, `api/admin/{stats,support-tickets,user-actions,onboarding-backfill}`.
Billing (FROZEN): `api/stripe/{checkout,cancel,portal,webhook}`.

## 6. Open issues to resolve during v19

- **P0** MW-02: canonical one-plan-per-user-per-local-day not enforced in prod (module unused).
- **P0** MW-03: verify Week page tz-correctness / rolling-7d vs `weekly/window.ts`.
- **P0** MW-04: deep readiness must cover migrations 044–048 subsystems, not just legacy 020/021.
- **P0** MW-05: prove cron/deletion schedules, leases, retries via a job registry.
- **P1** MW-10: repair-preview metric contradiction (scorecards require `plan_repair_previewed`, code may not emit it).
- Owner gates (NOT automatable): MW-06 (live billing/email/deletion rehearsal), MW-01/FINAL-01 live parts (apply migrations to prod, immutable RC via GitHub Actions, live-money evidence).

## 7. Non-goals and invariants (do not violate in v19)

- No Stripe price/catalog change; billing frozen at v16; `P0-LIVE-TRANSACTION` stays owner-accepted, not re-opened.
- No live charge/refund/production deletion/production seed. Migrations additive/reversible, RLS-aware, with preflight + verify queries; **owner applies them**.
- Never relabel `skipped/blocked/not_run/configured/mocked/locally_passed/owner-accepted` as `passed`. Never weaken a test, threshold, safety guard, privacy boundary or release gate to go green.
- No scope creep (no calorie tracking, medical advice, streaks, social feeds). Customer copy stays honest (no "production-ready/guaranteed/compliant/medically effective").
- One active release truth per repo; supersede — don't duplicate.

## 8. Execution order (Mellowa)

`00 → MW-02 → MW-03 → MW-07 → MW-04 → MW-05 → MW-10 → MW-12 → MW-08 → MW-09 → MW-11 → MW-13 → MW-14 → XAPP-01 → XAPP-02 → MW-01 → XAPP-03 → FINAL-01`.
Each committed as a focused change; exact test counts recorded after each; owner-only live steps handed off as runbooks.
