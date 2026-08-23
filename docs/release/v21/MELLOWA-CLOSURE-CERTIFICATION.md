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
| Branch | `v21` |
| Implementation SHA | `2ccc58779145a240837b6b7d8059bf9aa18a858f` |
| Audited base SHA | `e94adcc5b5f8b8a5fcb0f4ef38d5db4baa18c01a` (HEAD matched exactly at start — no drift) |
| package-lock hash | `cc21b8bc68425de288f8bfc3fba85bcafdcdb845` |
| Migration range | `001`–`054` (no new migration added by this pack) |
| Candidate lifecycle | **draft** — not frozen, not promoted |
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

| # | Severity | Blocker | Affected tier | Owner | Closure test |
|---|---|---|---|---|---|
| 1 | High | RC not frozen at `2ccc587`; local tests are not candidate evidence | capped beta+ | owner | `release-candidate.yml` green at the full SHA with attached artifacts |
| 2 | High | Migrations `050`–`054` NOT RUN in production | capped beta+ | owner | schema/RPC/RLS verification attached from prod |
| 3 | High | Paid readiness 200 under `LAUNCH_MODE=paid` unproven live | bounded paid | owner | authenticated `/api/health/ready` 200 at candidate SHA |
| 4 | High | Live billing/email/worker owner evidence absent | bounded paid | owner | Stage-5 owner checklist completed with redacted receipts |
| 5 | Low | Pre-existing STATUS-page↔manifest byte drift (2 snapshot tests) | none (doc hygiene) | owner | regenerate the STATUS pages from their manifests (out of v21 scope) |

## 7. Tiered verdicts (honest, evidence-based)

- **Product capability — STRONG.** The adaptive-day loop, safety boundaries and
  entitlement model are intact; v21 removes fail-open reads and a duplicate-spend
  window without changing positioning.
- **Capped beta — CONDITIONAL GO.** Code gate is green at `2ccc587`; the
  conditions are bounded, reversible and owner-accepted: freeze the RC (blocker 1)
  and apply/verify migrations `050`–`054` (blocker 2). Until both close, this is
  not a GO.
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

## 9. Next single owner action

**Freeze the release candidate at `2ccc587`** by running the immutable
`release-candidate.yml` against the disposable Supabase env with migrations
`050`–`054` applied there first. That produces the exact-SHA evidence needed to
turn the capped-beta CONDITIONAL GO into a GO; everything else in the paid tier
follows from the Stage-5 owner checklist.
