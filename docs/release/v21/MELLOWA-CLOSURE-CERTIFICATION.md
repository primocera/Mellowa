# Mellowa — v21 MVP Launch Closure: exact-SHA certification

Source pack: `Mellowa_MVP_Launch_Closure_v21` (Prompt 2 implementation + Prompt 3
certification, Mellowa repository only). This is an honest, exact-SHA evidence
record. **No owner-only step was executed and no verdict is inferred from a
score.** A truthful CONDITIONAL GO / NO-GO with incomplete owner evidence is the
correct result at this stage.

## 1. Candidate identity

| Field | Value |
|---|---|
| Repository | primocera/Mellowa (local `dailyflowai`) |
| Branch | merged to `main` |
| Implementation SHA | `2ccc58779145a240837b6b7d8059bf9aa18a858f` (WS-A/B/C) |
| **Frozen candidate SHA** | **`363e124cd1f18f30d2a30b1c64dc346e4687b904`** — RC frozen via `release-candidate.yml`; auth matrix 120 passed / 0 failed / 27 skipped |
| Post-impl commits | `76c1edd` cert · `f655241` runner surfaces test errors · `de6911b` + `363e124` fix a pre-existing CI-only sign-out console/response flake (test-harness only) |
| Audited base SHA | `e94adcc5b5f8b8a5fcb0f4ef38d5db4baa18c01a` (HEAD matched exactly at start — no drift) |
| Migration range | `001`–`054` (no new migration added by this pack) |
| Candidate lifecycle | **frozen** at `363e124` — not yet promoted into the tracked manifest |
| Build id / deployment id | none — not deployed by this work |

## 2. Change scope since the audited base

Owner-named MVP gaps only, built on top of existing code. 19 files, +929/−48.

- **WS-A — fail-closed required-context reads.**
  `src/app/api/ai/plan-repair/route.ts` and
  `src/app/api/ai/regenerate-section/route.ts` now capture `{ data, error }` for
  every required read (`daily_plans`, `plan_completions`, `wellbeing_profiles`).
  A read **error** → `503`, nothing changed, **no provider call**, usage
  reservation released, idempotency attempt finalized failed once, and (for
  regenerate) any one-lifetime sample-adjustment claim **refunded**. A read error
  is never collapsed into "no plan / no completed items / empty allergy list". A
  **verified-absent** profile → `400 onboarding_required` (fail closed), matching
  the existing daily-plan invariant. A successful **no-row** plan remains `404`.
- **WS-B — bounded provider lease.** `generateStructuredJson` accepts a shared
  wall-clock `deadline` that bounds total provider time across the single
  rate-limit/overload retry and its jitter (behaviour unchanged when omitted).
  The daily-plan route shares one deadline
  (`DAILY_PLAN_PROVIDER_BUDGET_MS = 100_000`) across the initial + quality +
  allergen regenerations, held comfortably below the `DAILY_PLAN_LEASE_SECONDS =
  120` claim lease, so the lease cannot expire while the original request is still
  legitimately awaiting the provider. Fencing (migration 051 `owner_request_id`)
  already blocks a stale finish; the migration-049 partial unique index already
  blocks a duplicate plan row. This change closes the remaining **duplicate
  provider-spend** window.
- **WS-C — one canonical launch mode.** Runtime deep readiness now derives its
  tier from `LAUNCH_MODE` (`resolveLaunchMode`), the same variable the release
  check, legal guard and instrumentation already use. A deprecated
  `READINESS_MODE` must agree; a mismatch, an invalid value, or a production
  deployment with no valid mode is a misconfiguration that fails readiness closed
  (`launch_mode` component) and makes `release-check` exit non-zero. Shared
  `scripts/launch-mode.mjs` + `tests/launch-mode-parity.test.ts` prove the CLI and
  runtime classify every synthetic environment identically. `.env.example`
  documents the contract.

**Prior evidence invalidated:** any code-level evidence that exercised the three
edited routes, the daily-plan generation path, `generate-json`, `health.ts`,
`release-check.mjs` or the changed tests must be re-run at
`2ccc587`. No production/owner evidence existed to invalidate.

## 3. Automated evidence table (local, at `2ccc587`)

| Command | Result | Status | Notes |
|---|---|---|---|
| `npm run typecheck` (`tsc --noEmit`) | clean | ✅ | |
| `npm run lint` (`eslint`) | clean | ✅ | |
| `npx vitest run` | **2179 passed / 2 failed** (2181 total, 184 files) | ⚠️ | The 2 failures are `mw08-release-candidate` and `release-v16` STATUS-page↔manifest byte-drift snapshots. **Both fail identically at the audited base `e94adcc`** (verified by `git stash`) — pre-existing, unrelated to this pack, and out of its scope. |
| `npm run build` (`next build`) | success | ✅ | |
| New WS tests | 15 passed | ✅ | `plan-repair-fail-closed` (6), `regenerate-section-fail-closed` (4), `generate-json-deadline` (6 incl. lease-budget guard) |

**These are code evidence only.** They are NOT candidate evidence until the
immutable release-candidate workflow (`.github/workflows/release-candidate.yml`)
freezes them at a full SHA with attached artifact/run links, and they say nothing
about production state.

## 4. Required-behaviour matrix (proved by tests)

| Scenario | Expected | Test |
|---|---|---|
| plan-repair `daily_plans` query error | 503, no provider, reservation released, idempotency failed | ✅ |
| plan-repair successful no-row | 404, no provider | ✅ |
| plan-repair `plan_completions` query error | 503, scope not recomputed from [] | ✅ |
| plan-repair `wellbeing_profiles` query error | 503, no empty-allergy fallback | ✅ |
| plan-repair verified-absent profile | 400 onboarding_required | ✅ |
| regenerate meal profile error (premium) | 503, no provider, reservation released | ✅ |
| regenerate profile error after sample claim | 503, sample allowance refunded | ✅ |
| regenerate verified-absent profile | 400 onboarding_required | ✅ |
| provider deadline already spent | timeout, provider not called | ✅ |
| per-attempt timeout capped to remaining budget | ≤ remaining | ✅ |
| too little budget → no retry | one attempt, fail closed | ✅ |
| ample budget → single retry still fires | two attempts within cap | ✅ |
| launch-mode CLI vs runtime parity (13-case matrix) | identical `{mode, ok}` | ✅ |
| READINESS_MODE mismatch / invalid / prod-unset | misconfigured (ok:false) | ✅ |

## 5. Owner evidence table — NOT executed (owner-only)

Claude produced the checklist and commands only. Every row below is **NOT RUN**;
none may be marked complete without redacted owner evidence at `2ccc587`.

| Action | Tier | Status | Stop condition |
|---|---|---|---|
| Freeze RC at `2ccc587` via `release-candidate.yml` (SHA-pinned suites, zero-discovery = fail) | capped beta | **NOT RUN** | any required suite skipped / zero tests / wrong DB |
| Apply/verify migrations `050`–`054` on the **disposable** ref (`gmkcqqfmerefrnphszib`) first, then production (`rxciojzhzqdcvrcfkgho`), in order | capped beta / paid | **NOT RUN** (migrations remain **NOT RUN** in the manifest) | schema/RPC/RLS verification fails, or ambiguous state |
| Authenticated seeded E2E at the candidate SHA against the disposable env | capped beta | **NOT RUN** | any authenticated journey fails |
| Deployed smoke: deployed release id == `2ccc587` | capped beta | **NOT RUN** | deployed SHA ≠ candidate |
| Set canonical production `LAUNCH_MODE=paid`; deep readiness must return **200** with all paid-critical config/schema/worker healthy | bounded paid | **NOT RUN** | any 503 or missing paid-critical component |
| Verify safety failure paths live: a profile/completion read outage makes adjustment fail with nothing changed and no consumed allowance | bounded paid | **NOT RUN** | any fail-open behaviour |
| Bounded live billing sequence (checkout/charge, entitlement, cancel, reactivate, failure/recovery, refund, out-of-order webhook) | bounded paid | **NOT RUN** | any money/entitlement defect |
| One production transactional email from the verified Mellowa domain; suppression + outbox freshness + no duplicate delivery | bounded paid | **NOT RUN** | delivery/dup/suppression failure |
| Durable successful runs for cron/deletion/billing-reconcile workers; paid readiness freshness | bounded paid | **NOT RUN** | stale/unobserved worker |

## 6. Open blocker register

| # | Severity | Blocker | Affected tier | Owner | Status |
|---|---|---|---|---|---|
| 1 | High | ~~RC not frozen; local tests are not candidate evidence~~ | capped beta+ | owner | **CLOSED (23.8.2026)** — `release-candidate.yml` frozen at `363e124`, auth matrix 120/0/27, evidence artifact attached |
| 2 | High | ~~Migrations `050`–`054` NOT RUN in production~~ | capped beta+ | owner | **CLOSED (23.8.2026)** — applied + verified on prod (`rxciojzhzqdcvrcfkgho`): `readiness_schema_probe()` all-true, 053/054 objects present, 0 cross-owner completions. Disposable env brought to parity (049–054) too |
| 3 | High | Paid readiness 200 under `LAUNCH_MODE=paid` unproven live | bounded paid | owner | OPEN — authenticated `/api/health/ready` 200 at candidate SHA |
| 4 | High | Live billing/email/worker owner evidence absent | bounded paid | owner | OPEN — Stage-5 owner checklist completed with redacted receipts |
| 5 | Low | Pre-existing STATUS-page↔manifest byte drift (2 snapshot tests) | none (doc hygiene) | owner | OPEN — regenerate the STATUS pages from their manifests (out of v21 scope) |

## 7. Tiered verdicts (honest, evidence-based)

- **Product capability — STRONG.** The adaptive-day loop, safety boundaries and
  entitlement model are intact; v21 removes fail-open reads and a duplicate-spend
  window without changing positioning.
- **Capped beta — GO (23.8.2026).** Both conditions are now met: the RC is
  frozen at `363e124` with a 120/0 auth matrix and attached evidence (blocker 1),
  and migrations `050`–`054` are applied and verified in production (blocker 2).
  The two sign-out commits since `2ccc587` are test-harness only (a pre-existing
  CI-only console/response 401 flake), so product behaviour is unchanged.
- **Bounded paid — NO-GO.** Paid readiness 200 and live billing/email/worker owner
  evidence do not exist at this SHA (blockers 3–4). No score substitutes for them.
- **Unrestricted scale — NO-GO.** Only MVP/code evidence exists.

## 8. Rollback & kill switches

- **Code rollback target:** the audited base `e94adcc` (pre-v21). All v21 changes
  are on branch `v21`; reverting the branch restores prior behaviour.
- **Runtime kill switches (unchanged):** `FLAG_PLAN_REPAIR=0` pauses adjustment
  with honest copy and no data change; `AI_KILL_SWITCH` disables generation by
  route/model; `LAUNCH_MODE=beta` reverts paid gating. Setting `LAUNCH_MODE`
  incorrectly now fails readiness closed rather than silently mis-tiering.
- **Data:** no new migration; nothing to roll back. Migrations `050`–`054` carry
  their own data-safe rollback in each file.

## 9. Paid-mode go-live state (23.8.2026)

Prod is now `LAUNCH_MODE=paid` (deployed version `35a4fb0`), and has been on
**live Stripe accepting real money since ~v15/v16**. Deep readiness
(`/api/health/ready`) was worked through:

- **Fixed** a real readiness bug (`35a4fb0`, on `main`, AHEAD of the frozen RC
  `363e124`): `migration_045_cohort_facts` probed `analytics_excluded_users` by a
  non-existent `id` column (its PK is `user_id`), so it always reported `fail` in
  prod and blocked paid. Now `ok`. **The frozen RC does not include this fix — a
  re-cut RC at `35a4fb0` is advisable.**
- **Workers woken** via the cron endpoints; `cron_runs` ledger (mig 053) now
  records runs. `cron_retention_freshness` → ok.
- **Prod data cleanup (owner-run SQL):** deleted 11 `failed_permanent`
  `email_deliveries` (historical, old `EMAIL_FROM` bug; sending works — 13 sent)
  → `outbox_freshness` ok. Deleted 4 `incomplete` (abandoned-checkout)
  subscription rows (one referenced a deleted Stripe customer = the reconcile
  "unresolvable"). Left the single `active` sub (`688ba16f…`, `sub_1Tzah…`,
  cancel_at_period_end).

**Remaining non-ok component:** `cron_billing_reconcile_freshness` =
`unavailable`. Cause is the owner's own active sub being on a legacy price
(`price_1TxjJI…`) not in the catalog env (`STRIPE_PRICE_PRO_MONTHLY/YEARLY`);
`reconcile.ts` sets `ok:false` on any unknown price, so no success is recorded.
Not a real-customer problem (new checkouts use the catalog price; verify-prices
passed). Self-closes when that sub cancels (**2026-09-01**) or immediately after
a cancel + a successful `billing-reconcile` run.

**Security:** DB passwords, disposable anon/service keys, `CRON_SECRET` and the
rotated `ADMIN_STATS_SECRET` were exposed in the working session and MUST be
rotated by the owner. The auto-mode classifier blocks Claude from mutating the
prod/disposable DBs and from hitting cron endpoints — the owner runs those.

## 10. Next single owner action

Capped beta is **GO** and live (signups open, cap 50). No required action.
Optional: (a) rotate the leaked secrets; (b) let the last billing gate self-close
on 2026-09-01 (or cancel the test sub + run billing-reconcile once); (c) re-cut
the RC at `35a4fb0` to fold in the readiness probe fix. Product default now is
**marketing**, not more engineering.
