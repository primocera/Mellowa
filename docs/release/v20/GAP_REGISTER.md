# v20 — MW-00 Baseline & Gap Register

> Final Launch Hardening pack (v20). Branch `v20`. Machine-checked baseline, not a certification.
> Owner-only actions (production migrations, live Stripe/email/cron, deploy, RC promotion) remain **NOT RUN**.

## Baseline identity
- **Pack baseline SHA:** `6a0a81a3a27551181da005dd699c9443a8c5edeb` (on `main`).
- **v20 branch HEAD at start:** `4b1c95f8db3c02eaa5313df1d0f941030de91030`.
- **Drift baseline → HEAD:** 3 commits, all **docs-only / net-zero**:
  - `f92b8bc` soften NEXT_STEPS tone (docs)
  - `33496c0` + `2396e6d` sage/amber copy tweak, then `4b1c95f` **revert** of `2396e6d` (net-zero on that surface).
  - Classification: no runtime/test/migration/config drift. All valid; preserved.
- Migrations present through **049** (`044`–`049` are v18/v19). None proven applied to production.

## Baseline gate (executed at HEAD `4b1c95f`, this machine)
| Suite | Command | Result |
|---|---|---|
| typecheck | `npm run typecheck` | **PASS** (tsc clean) |
| unit/contract/safety | `npm run test` (vitest) | **2026 pass / 1 fail / 2027 total** — see note |
| eval | `npm run eval` | **PASS** 81/81 |
| lint | `npm run lint` | running at time of write — see final report |
| production build | `npm run build` | running at time of write — see final report |
| e2e (authenticated) | `npm run test:e2e:matrix` | **NOT RUN** (owner/seeded env) — honestly skipped |

**Test note (the 1 baseline failure):** `tests/release-v16.test.ts › the human status page
is generated from the manifest › matches a fresh render byte for byte`. At the pristine
baseline this was a **local line-ending artifact only**: `docs/release/v16/STATUS.md` is
checked out with CRLF on Windows (`core.autocrlf`), while `renderStatusPage()` emits LF, so
`onDisk !== fresh`. On CI/Linux the working copy is LF and the test passes — environmental,
not a runtime/release gap. It was subsequently resolved *legitimately* during MW-01: adding
migration `050` required appending `"050"` to the v13 and v16 manifest migration inventories
(the "enumerate the COMPLETE on-disk migration set" contract), and regenerating STATUS.md via
`npm run render-release-status` rewrote the page (now "Migrations: 50 (001–050)") with LF —
a real content change, not line-ending churn.

## Release truth (reconciled, not cut)
- Canonical manifest `docs/release/manifest.v16.json`: no frozen candidate; baseline draft;
  verdicts UNASSESSED; open blocker `P0-LIVE-TRANSACTION`. **Left UNASSESSED** — no RC is cut
  in MW-00, and none may be marked certified. MW-08 handles RC cut prep.

## Gap register (real runtime gaps, ranked by severity)

Each row: reproduction · affected journey · severity · code evidence · acceptance · owner · prompt.

### G1 — Completion cross-user integrity + stale-day (P0, security/data-integrity) → MW-01
- **Evidence:** `src/app/api/plan/complete/route.ts:57-75` upserts/deletes `plan_completions`
  keyed only by `user_id`; it never verifies the parent `daily_plans` row belongs to the user.
  `supabase/migrations/004_*.sql`: `plan_completions` has `unique (daily_plan_id, item_key)`
  **global** and INSERT policy checks only `auth.uid() = user_id` (no parent-ownership EXISTS),
  no UPDATE policy.
- **Failure:** an attacker who learns a victim's `daily_plan_id` inserts `(attacker_id,
  victim_plan_id, "movement")`. The owner's later upsert hits the global unique conflict →
  `ON CONFLICT DO UPDATE` needs an UPDATE policy the owner lacks on the foreign row → RLS
  denies → owner is denial-of-serviced on that item. No stale-day guard: completing a
  superseded/yesterday/tomorrow plan is accepted.
- **Acceptance:** API + DB both enforce parent ownership; foreign UUID → generic 404, zero
  row, zero analytics; pre-existing malicious row cannot block owner after migration; stale/
  superseded/future/cross-midnight → 409 `stale_day`; analytics only after durable write.
- **Owner:** none beyond applying the additive migration. **Prompt:** MW-01.

### G2 — Daily-plan dedup is post-provider, not atomic pre-provider (P0/P1, cost/trust) → MW-02
- **Evidence:** `src/app/api/ai/daily-plan/route.ts:119-137` pre-reads the canonical plan
  (check-then-act, racy). The idempotency claim (`:141-167`,
  `src/lib/ai/idempotency.ts`, RPC `claim_generation_request` in
  `migrations/020_*.sql`) is keyed on `(user_id, route, idempotency_key)` — so two concurrent
  requests with **different** idempotency keys both claim and both call the provider.
  Migration 049's partial unique index rejects only the second *insert*, **after** cost is
  incurred.
- **Failure:** two tabs / double submit with distinct idem keys → two provider calls, two
  usage reservations for one canonical day; the losing request's provider cost is recorded.
- **Acceptance:** atomic DB claim keyed by `user_id + route=daily-plan + canonical local
  date` acquired **before** usage reservation / check-in write / provider call; exactly one
  provider call, one reservation/finalization, one plan, one sample event; deterministic
  lease recovery on crash; 049 remains an integrity backstop, not the dedup mechanism.
- **Prompt:** MW-02. **Status: CLOSED** — migration 051 adds a `(user_id,
  local_date)` claim table + `claim_/finish_daily_plan_generation` RPCs (advisory
  lock, lease, `owner_request_id` fencing token). Route acquires it before usage
  reservation/check-in/provider; unavailable → 503 fail-closed. Tests assert
  provider-call-count under gated concurrency (`tests/daily-plan-claim-route.test.ts`).

### G3 — Timezone / weekly-facts fail *open* on DB errors (P1, data truth) → MW-03
- **Evidence:** `src/app/api/week/reflection/route.ts:31-42` `resolveTimeZone` discards the
  Supabase `error` and returns `"UTC"` on any failure. GET (`:71-106`) coerces failed
  queries to `[]` (`plansRes.data ?? []` etc.), so an outage renders as an empty week. The
  daily-plan local-day path (`resolvePlanDate`) similarly cannot distinguish "no timezone"
  from "read failed".
- **Failure:** a transient profile/weekly read error mutates the wrong day (UTC fallback) or
  shows a real week as blank.
- **Acceptance:** one error-aware resolver → `resolved | missing_or_invalid | unavailable`;
  mutations/weekly GET return 503 `data_unavailable` on read failure with zero writes/events;
  documented UTC fallback only for genuinely absent/invalid profile data.
- **Prompt:** MW-03. **Status: CLOSED** — shared error-aware resolvers
  (`resolveTimeZoneState` / `resolveCurrentDay` in `src/lib/dates/current-day.ts`)
  and the mutation guard (`checkPlanIsToday`, now returns `unavailable`) fail
  closed with 503 on a read outage. Weekly GET returns 503 if the tz read OR any
  of the four facts queries errors (no partial-array facts); daily-plan/repair/
  regenerate profile-read outages → 503 instead of wrong-day mutation.
  Fallback policy: valid stored IANA zone → local date; genuinely missing/invalid
  → documented UTC/bounded-client fallback; read **error** → `unavailable`/503.

**Canonical fallback policy** (single source of truth): the timezone fallback is
defined in `src/lib/dates/current-day.ts` (`resolveTimeZoneState` /
`resolveCurrentDay`) and `src/lib/dates/local-day.ts` (`resolvePlanDate`). A
resolved valid IANA zone wins; a genuinely absent/invalid zone uses the bounded
client-date-or-server-date fallback (never mutates outside ±1 day); a failed
**read** is `unavailable` and every content mutation / weekly surface returns
503 `data_unavailable` with zero writes and zero analytics.

### G4 — Paid readiness does not fail closed on config/schema/worker truth (P0/P1) → MW-04
- **Evidence:** `src/app/api/health/ready/route.ts:70-76` marks email/stripe/ai/cron config
  `not_configured`, which `src/lib/health.ts:42` states "never blocks". Line ~112 probes only
  the `superseded_at` **column**, not the `daily_plans_user_date_canonical` partial unique
  index or the MW-01 completion-ownership constraint. `classifyRpcProbe` treats non-
  `PGRST202` errors leniently. Worker freshness covers only deletion + outbox.
- **Acceptance:** paid mode fails on missing Stripe/AI/cron/required-email/legal config;
  probes exact index predicate + MW-01 constraint; RPC probe accepts only the precise
  expected coercion error or a clean result; freshness for all registered critical jobs;
  release-check ↔ readiness config parity; unknown ⇒ fail closed for paid.
- **Prompt:** MW-04. **Status: CLOSED (schema/config/RPC parts); worker-freshness
  for the remaining jobs completes in MW-05.** `summarizeReadiness` now fails paid
  closed on a critical `not_configured`; config components derive from the shared
  contract `config/paid-required-env.json` (also drives `release-check.mjs`);
  migration 052 adds a read-only `readiness_schema_probe()` proving the 049 partial
  unique index predicate + MW-01 ownership policy + 051 claim objects (not just a
  column); `classifyRpcProbe` now maps permission/timeout/transport/unknown →
  `unavailable` (not optimistic ok). See the component matrix below.

### Readiness component matrix (MW-04)
| Component | Probe | Critical (paid) | Failure status | Owner action |
|---|---|---|---|---|
| database | select profiles head | yes | fail | check Supabase/service-role |
| migration_044–049 | table/column presence | yes | fail | apply migration |
| schema_daily_plans_canonical_index | `readiness_schema_probe()` index predicate | yes | fail | apply 049 |
| schema_plan_completions_parent_ownership | probe INSERT policy WITH CHECK | yes | fail | apply 050 |
| schema_daily_plan_claims_table / _fn | probe table + fns | yes | fail | apply 051 |
| rpc_claim/undo/deletion_stats | malformed-uuid coercion | yes | fail/unavailable | apply RPC migration |
| deletion_worker_freshness / outbox_freshness | account_deletion_stats / email_deliveries counts | yes (paid) | degraded/unavailable | run/inspect worker |
| config_* (Stripe/AI/cron/email/legal) | env presence | yes (paid) | not_configured→fail(paid) | set env var |

Beta mode: worker degraded/unavailable and config not_configured are warn-only;
a missing required object (`fail`) blocks in **both** modes. `READINESS_MODE=paid`
opts into strict.

### G5 — Cron registry is descriptive metadata, not enforced execution (P1, operations) → MW-05
- **Evidence:** `vercel.json` schedules only `trial-reminders` and `daily-reminders`; four
  other registered jobs (email outbox, deletion, retention, billing-reconcile) rely on an
  external pinger. `src/lib/ops/cron-registry.ts` claims `cron_leases` for retention/billing-
  reconcile but their routes did not visibly acquire a lease at review. No durable `cron_runs`
  ledger; readiness cannot consume real last-success.
- **Acceptance:** durable `cron_runs`/heartbeat model; shared execution helper recording
  start/success/failure; real overlap protection or documented tested idempotency; readiness
  consumes ledger; admin status view (no PII); owner setup checklist for external pingers
  (**config stays NOT RUN**).
- **Prompt:** MW-05. **Status: CLOSED.** Migration 053 adds the durable
  `cron_runs` ledger + `record_cron_run_start/finish` + `cron_job_health()`. One
  shared helper `runCronJob` validates the registry id, acquires the declared
  `cron_leases` lease with an explicit fail-closed policy (`evaluated` flag on
  `acquireCronLease`), and records every run (safe category only). retention +
  billing-reconcile now genuinely acquire the lease they declared. Readiness
  consumes `cron_job_health()` for `cron_retention_freshness` /
  `cron_billing_reconcile_freshness` (critical in paid). Admin view
  `/api/admin/cron-runs` (counts/categories only, `neverRun` surfaced). Contract
  test now fails if a `cron_leases` job never acquires a lease. Owner external-
  pinger config + live delivery remain NOT RUN (checklist in `docs/ops-cron.md`).

### G6 — Two competing "expansion OK" signals; doc-string test only (P0 for scale) → MW-06
- **Evidence:** `src/lib/analytics/loop-decisions.ts` `expansionVerdict` can return
  `canExpand=true` from one late-day check-in signal + 28-day window. `pricingDiscovery` and
  `observability.scaleReady` are computed separately and do **not** constrain
  `report.expansion.canExpand`. A documentation-string test asserts the "unavailable means
  wait" claim without exercising the combined runtime function.
- **Acceptance:** one canonical `scaleDecision` combining value gates + support + pricing +
  observability + billing incidents + owner gates with strict precedence (no averaging);
  `pricingDiscovery=false` or `scaleReady=false` force `canExpand=false`; runtime-composition
  tests replace source-string tests; single authoritative expansion result in admin + CSV.
- **Prompt:** MW-06. **Status: CLOSED.** New `src/lib/analytics/scale-decision.ts`
  composes value gates + pricing discovery + observability + data freshness +
  disputes + cap + owner gates under strict precedence (STOP→HOLD/BLOCK→PAUSE_INTAKE
  →ITERATE→SMALL_BOUNDED_EXPANSION), no averaging. `pricingDiscovery=false` or
  `scaleReady=false` force `canExpand=false`; unavailable/immature/suppressed/stale
  all mean WAIT. `releaseGatesPassed` defaults false so real-world expansion stays
  BLOCKED. `report.scaleDecision` is the single authority; `expansion` re-labeled
  diagnostic; admin + CSV surface only the canonical result. Runtime-composition
  truth-table tests (`tests/mw06-scale-decision.test.ts`, 14) replace reliance on
  the doc-string test.

### G7 — Support burden ledger honest-but-empty; no verifiable ingestion (P1) → MW-07
- **Evidence:** `src/lib/support/metrics.ts` + `src/app/api/admin/support-tickets/route.ts`
  exist and correctly return `unavailable` when ingestion is unverified; user surfaces are
  `mailto:` only; `SUPPORT_INGESTION_VERIFIED` is an operator attestation, not proof.
- **Acceptance:** privacy-safe manual CSV/JSON metadata import behind admin auth (reject
  body/subject/email/attachments), idempotent upsert, durable coverage/staleness → verified
  state; missing/stale coverage ⇒ unavailable in burden + scale decision; deletion handling.
  Real inbox ingestion stays **NOT RUN**.
- **Prompt:** MW-07. **Status: CLOSED (manual import path); real inbox/provider
  ingestion stays NOT RUN.** Migration 054 adds `support_ingestion_runs` (durable
  coverage: source/counts/window/actor, metadata only). Admin route gains a
  privacy-safe BATCH import (`{source, coverage_start/end, tickets[]}`) — strict
  schema rejects any body/subject/email/attachment key, chronology validated,
  idempotent upsert by unique `external_ref`, one durable coverage run per batch.
  `verified` now = durable recent coverage **AND** the operator attestation (env
  flag alone no longer certifies an empty ledger); stale/absent coverage →
  unavailable in burden → pricing-discovery closed → scaleDecision HOLD. Deletion
  anonymization already via `account_user_id ... on delete set null` (047).

### MW-08 — migration plan + immutable RC prep. **Status: PREPARED (owner cuts RC).**
`docs/release/manifest.v20.json` (draft, UNASSESSED, migrations 001–054, owner-gate
blockers P0-V20-MIGRATIONS-APPLIED / P0-V20-RC-NOT-CUT / P1-V20-AUTH-E2E-AT-HEAD) +
rendered `docs/release/v20/STATUS.md`. `docs/release/v20/MIGRATION_PLAN.md` gives the
ordered preflight/apply/verify/rollback for 050–054 and the deploy-after-migrate
invariant. `tests/mw08-release-candidate.test.ts` validates the manifest, its honest
non-certified state, migration idempotency/rollback, and plan coverage. The immutable
RC workflow (`.github/workflows/release-candidate.yml`) is intact; **cutting/promoting
it and applying prod migrations remain OWNER-ONLY, NOT RUN.**

### MW-09 — owner-live rehearsal validators. **Status: PREPARED (validators only).**
`src/lib/release/rehearsal-evidence.ts` validates a per-gate evidence artifact and
refuses stale SHA, wrong environment, a missing transition, a billing run with no
refund, a zero-test synthetic claim, and any PII/card/token content. Runbook
`docs/runbooks/v20-rehearsals.md` gives steps + STOP conditions per gate (billing/
email/reminder/outbox/cron/deletion) and the foreign-app isolation note. Tests
`tests/mw09-rehearsal-evidence.test.ts` (11). **Live money/email/deletion + external
pinger config remain OWNER-ONLY, NOT RUN.**

### Owner-gated (release evidence, not code gaps) → MW-FINAL
- Migrations 044–049 (+ new v20 migrations) not proven applied in production.
- No immutable RC cut at the current SHA; authenticated E2E matrix not carried at this SHA.
- Live billing/email/reminder/outbox/cron/deletion rehearsals NOT DONE.
- Cross-app shared-Stripe isolation must be re-proven at the v20 SHA (XAPP-01).

## Constraints honored in MW-00
- No change to pricing, trial length, medical/safety posture, IA, or public positioning.
- No runtime gap closed with a source-string test or prose.
- Skipped authenticated E2E and unapplied migrations recorded as such — not "passed".
- Manifest left UNASSESSED; no RC marked certified.

## Next single action
Implement **MW-01** (completion parent-ownership + stale-day) — highest severity (P0 security).
