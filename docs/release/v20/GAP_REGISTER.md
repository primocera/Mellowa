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
- **Prompt:** MW-04.

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
- **Prompt:** MW-05.

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
- **Prompt:** MW-06.

### G7 — Support burden ledger honest-but-empty; no verifiable ingestion (P1) → MW-07
- **Evidence:** `src/lib/support/metrics.ts` + `src/app/api/admin/support-tickets/route.ts`
  exist and correctly return `unavailable` when ingestion is unverified; user surfaces are
  `mailto:` only; `SUPPORT_INGESTION_VERIFIED` is an operator attestation, not proof.
- **Acceptance:** privacy-safe manual CSV/JSON metadata import behind admin auth (reject
  body/subject/email/attachments), idempotent upsert, durable coverage/staleness → verified
  state; missing/stale coverage ⇒ unavailable in burden + scale decision; deletion handling.
  Real inbox ingestion stays **NOT RUN**.
- **Prompt:** MW-07.

### Owner-gated (release evidence, not code gaps) → MW-08 / MW-09 / MW-FINAL
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
