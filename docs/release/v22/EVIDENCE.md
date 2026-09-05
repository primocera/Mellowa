# Mellowa v22 — owner-run production evidence

Direct evidence recorded as it is produced. Each entry names who ran it, when
(UTC), where, and the exact result. No secret values are recorded. Items not
listed here remain **NOT RUN** in `manifest.v22.json`.

---

## 1. Migrations 050–054 applied + verified in production

- **Status:** VERIFIED ✅
- **Run by:** Primoz Cerar (owner), Supabase SQL editor
- **When:** 2026-08-30 (UTC)
- **Target:** production Supabase `rxciojzhzqdcvrcfkgho`
- **Probe:** `scripts/verify-migrations-050-054.sql` (exact schema / index / RPC /
  RLS / policy probes; `052` also runs `readiness_schema_probe()` and asserts every
  invariant is true)
- **Result:** **19 / 19 rows PASS, 0 FAIL.**

| mig | check | result |
|---|---|---|
| 050 | insert policy enforces parent ownership | PASS |
| 050 | update policy exists (idempotent upsert path) | PASS |
| 050 | no cross-owner completions remain (repair applied) | PASS |
| 051 | daily_plan_generation_claims table exists | PASS |
| 051 | owner_request_id fencing column exists | PASS |
| 051 | RLS enabled on claims table | PASS |
| 051 | claim_daily_plan_generation() exists | PASS |
| 051 | finish_daily_plan_generation() exists | PASS |
| 052 | readiness_schema_probe() exists | PASS |
| 052 | probe reports all invariants true | PASS |
| 052 | 049 partial-unique canonical index present (predicate) | PASS |
| 053 | cron_runs table exists | PASS |
| 053 | RLS enabled on cron_runs | PASS |
| 053 | record_cron_run_start() exists | PASS |
| 053 | record_cron_run_finish() exists | PASS |
| 054 | support_ingestion_runs table exists | PASS |
| 054 | RLS enabled on support_ingestion_runs | PASS |
| 054 | coverage_end column exists (staleness driver) | PASS |

**Scope note:** v22 adds no migration, so the verified production schema
(`050–054`) is exactly the schema the v22 code expects; this evidence is not
invalidated by the app SHA moving. It closes `P0-V22-MIGRATIONS-APPLIED`.

---

## 2. Immutable release candidate + authenticated E2E matrix

- **Status:** FROZEN + GREEN ✅
- **Workflow:** `Release Candidate (immutable gate)` run **#17**
- **Run:** https://github.com/primocera/Mellowa/actions/runs/33284292315 — **conclusion: success** (7m 53s)
- **Frozen RC SHA:** `974e534ea956e19acbb672701b97fe8d27f6944b`
- **Artifact:** `rc-evidence-974e534…` · **sha256** `2f07ae7466e3bda5fce9d0a916626ed0a957b02f6bfac160294e0e9cc90f28ed`
- **Jobs certified (all required, all passed):** manifest validation, status-page
  sync, lint, typecheck, unit/contract/safety, eval gate, production build, public
  browser journeys, and the **authenticated E2E matrix**. This workflow **fails
  closed** if the authenticated matrix is skipped or discovers zero tests — so a
  green conclusion proves the matrix ran and passed against the seeded
  non-production Supabase (Stripe TEST mode). Exact passed/failed/skipped counts
  live inside the `rc-evidence` artifact.
- Closes `P0-V22-RC-NOT-CUT` and `P1-V22-AUTH-E2E-AT-HEAD`.

**Note:** this also confirms the 2 test failures seen locally on Windows are pure
LF/CRLF render-drift on the historical v16 STATUS page — the same suite is green in
CI (Linux/LF) in this run.

---

## 3. Paid-readiness / billing reconcile — root cause (diagnosed, self-resolving)

- **Status:** BLOCKED, root cause known, self-resolves 2026-09-01
- **Diagnosed:** 2026-08-30 from prod `cron_runs` + `subscriptions`
- **Finding:** `cron_job_health()` shows `billing-reconcile` last ran **2026-08-23**,
  `status=failure`, `error_category=reconcile_exception`, `lease_outcome=acquired`,
  `last_success_at=null` → readiness component `cron_billing_reconcile_freshness=unavailable`.
- **Why:** the ONLY subscription is the owner's own — user `688ba16f…`,
  `plan_name=pro_monthly`, `active`, `cancel_at_period_end=true`,
  `current_period_end=2026-09-01`. It is on a Stripe price id the current catalog
  no longer maps (`planNameForPrice()=null`), so `reconcileBilling` records it in
  `unknownPrices`, sets `report.ok=false`, and the job is marked failed.
- **Resolution (owner, no code change):** the sub is already scheduled to cancel
  **2026-09-01**. Once it ends (or is cancelled sooner in Stripe), a single
  billing-reconcile run returns `ok` and writes the durable success row →
  `cron_billing_reconcile_freshness=ok` → paid readiness can reach 200. Not
  suppressed or special-cased in code.
- This was first surfaced in v21; recorded here so it is not re-diagnosed again.

---

## 4. Production deploy confirmed

- **Status:** DEPLOYED ✅ (public health probe)
- **Deployed SHA:** `c6e6f091b2d038b3de1e7d74da7d900391d6591e` (`c6e6f09`)
- **Evidence:** public `/api/health` returns `version: c6e6f09` — the current
  `main` HEAD. This is a **documentation-only superset** of the frozen RC
  `974e534` (only release-truth commits after the freeze), so the frozen RC still
  certifies the shipping code. Recorded as `buildId` in `manifest.v22.json`.
- **Note:** this confirms the *code is live*. It does **not** by itself close paid
  readiness — authenticated `/api/health/ready` with `LAUNCH_MODE=paid` = 200 (which
  needs `cron_billing_reconcile_freshness=ok`) is still owner-run (see §3 and the
  certification's "Path to full public-paid GO").

---

## 5. Secret rotation

- **Status:** DONE ✅ (owner-attested)
- **Attested by:** Primoz Cerar (owner)
- **When:** 2026-09-05 (UTC)
- **Scope:** the previously-reported-exposed credentials (database credentials,
  disposable keys, `CRON_SECRET`, `ADMIN_STATS_SECRET`) were rotated and the
  dependent services redeployed, per `docs/runbooks/key-rotation-and-backup.md`.
- **Evidence hygiene:** metadata only. No secret value is printed, retrieved or
  committed. Key ids live in the rotation provider console, not here.

---

## Still NOT RUN (owner) — the path to full public-paid GO

Recorded here only when direct evidence exists. See certification §10 for how each
flips the derived verdict:

- billing-reconcile durable `success` after the legacy sub ends — the 2026-09-01
  end date has now **passed** (today 2026-09-05); only one reconcile run +
  recording remains (see §3). Closes `P0-V22-PAID-READINESS`.
- Live Stripe rehearsal (A–H: charge/cancel/reactivate/failure/recovery/late-drop/
  refund) + one real transactional email with replay idempotency. Closes
  `P0-LIVE-TRANSACTION`.
- ~~Secret rotation~~ **DONE 2026-09-05 (owner-attested) — see §5.**
- Authenticated `/api/health/ready` (paid) = 200 + `npm run release-check` ready on
  the deployed SHA → record the `release-check` suite `ci_pass`.
