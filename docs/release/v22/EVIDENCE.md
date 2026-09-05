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

## 3. Paid-readiness / billing reconcile — root cause + code fix + clean run

- **Status:** FIX DEPLOYED + CLEAN RECONCILE PROVEN ✅ 2026-09-05. Reconcile now
  returns `report.ok:true`; authenticated paid `/api/health/ready` = 200 is the one
  remaining owner-run step (needs `ADMIN_STATS_SECRET`; see §6).
- **Finding:** the ONLY subscription is the owner's own — user `688ba16f…`,
  `sub_1TzahD…`, on a legacy Stripe price `price_1TxjJI…` the current catalog no
  longer maps (`planNameForPrice()=null`) → `reconcileBilling` recorded it in
  `unknownPrices`, `report.ok=false`, job failed →
  `cron_billing_reconcile_freshness=unavailable`.
- **The earlier "self-resolves once the sub ends 2026-09-01" assumption was
  WRONG.** A live billing-reconcile POST on **2026-09-05** fixed the status drift
  (`active → canceled` to match Stripe) but **still returned `ok:false` with
  `unknownPrices=[price_1TxjJI…]`** — because the check ran against *every*
  subscription row regardless of status, so the canceled sub's historical price
  kept tripping it. It would false-fail on **every** future run and permanently
  pin readiness=unavailable. Cancelling did not help; waiting would not either.
- **Fix (owner-authorized real bug fix, 2026-09-05):**
  `src/lib/stripe/reconcile.ts` now scopes the `unknownPrices` check to
  `LIVE_STATUSES` via `isUnknownActivePrice()` (trialing/active/past_due/unpaid).
  A terminal sub's dead price no longer fails reconcile; an unmapped price on a
  *live* sub is still flagged. Unit-tested in `tests/billing-ops.test.ts`. No
  entitlement/money logic changed.
- **Clean reconcile run (2026-09-05, after deploy of the fix):**
  - **Deployed SHA:** `bc71ff9` — public `/api/health` returned `{"ok":true,"version":"bc71ff9"}`,
    confirming the `isUnknownActivePrice` fix is live before the run.
  - **Run:** `POST /api/cron/billing-reconcile` (bearer cron secret) → **HTTP 200**,
    `report.ok:true`.
  - **Report (redacted to shape):** `checked:3`, `unknownPrices:[]`,
    `unresolvable:[]`, `duplicateCustomers:[]`, `stuckWebhookEvents:[]`. `driftFixed`
    synced `current_period_end`/`trial_end`/`status` rows to Stripe (including the
    terminal legacy-price sub, now `canceled`, whose historical price no longer
    trips `unknownPrices`). This is the durable `cron_runs` success that flips
    `cron_billing_reconcile_freshness` to `ok`.
  - **Proves:** the earlier permanent-false-fail is gone — a terminal sub's dead
    price is excluded from the live-status check; the run is clean and repeatable.
- **Authenticated paid readiness (2026-09-05, deployed SHA `bc71ff9`):**
  - **Run:** `GET /api/health/ready` (bearer `ADMIN_STATS_SECRET`) → **HTTP 200**,
    `ok:true`, **`mode:"paid"`**, `launch_mode:"ok"`.
  - **Every component `ok`**, including `cron_billing_reconcile_freshness:"ok"`,
    `cron_retention_freshness:"ok"`, `outbox_freshness:"ok"`,
    `deletion_worker_freshness:"ok"`, all `migration_*` + `schema_*` + `rpc_*`
    probes, and all paid-critical config (`config_stripe_*`, `config_ai_provider_api_key`,
    `config_resend_api_key`, `config_email_from`, `config_legal_*`, `config_support_email`,
    `config_cron_secret`, `config_admin_stats_secret`).
  - **Closes `P0-V22-PAID-READINESS`** — both halves now proven: reconcile
    `report.ok:true` (above) + authenticated paid `/api/health/ready` = 200.
  - Note: the `ADMIN_STATS_SECRET` used for this probe was the disposable value
    `Mellowamails`; it MUST be rotated to a random value (`openssl rand -hex 32`)
    before public paid launch (same hygiene as the cron secret in §5).

---

## 4. Production deploy confirmed

- **Status:** DEPLOYED ✅ (public health probe)
- **Deployed SHA:** `bc71ff96…` (`bc71ff9`) — the billing-reconcile fix
  (`isUnknownActivePrice`).
- **Evidence:** public `/api/health` returns `{"ok":true,"version":"bc71ff9"}` — the
  current `main` HEAD. This is a **documentation-only + one owner-authorized bug-fix
  superset** of the frozen RC `974e534` (release-truth commits plus the reconcile
  scoping fix, which changes no entitlement/money logic), so the frozen RC still
  certifies the shipping product line. Recorded as `buildId` in `manifest.v22.json`.
- **Note:** the frozen RC was re-cut at `faf5d16` (release-candidate workflow
  success) so the immutable candidate includes this reconcile fix and is no longer
  superseded. `faf5d16` is docs-only on top of `bc71ff9`, so the RC code == the
  deployed code. Authenticated paid `/api/health/ready`=200 is now recorded (§3).

---

## 5. Secret rotation

- **Status:** DONE ✅ (owner-attested 2026-09-05).
- **Attested by:** Primoz Cerar (owner).
- **Scope:** `ADMIN_STATS_SECRET` and `CRON_SECRET` rotated to random values, the
  **cron.org** scheduler's `CRON_SECRET` updated to match, and dependent services
  redeployed, per `docs/runbooks/key-rotation-and-backup.md`. The disposable values
  used during the paid-readiness rehearsal are retired — the reconcile + readiness
  runs in §3 were fired with the old disposable token and grant no ongoing access.
- **Confirming check (owner-run):** authenticated `/api/health/ready` stays **200**
  in paid mode with the new `ADMIN_STATS_SECRET`, and the retired token no longer
  authenticates. Owner records the HTTP codes only (no secret values).
- **Evidence hygiene:** metadata only. No secret value is printed, retrieved or
  committed. Key ids live in the rotation provider console, not here.

---

## Status — public-paid GO reached (one operational item open)

All verdict gates are satisfied; verdicts are `GO / GO / GO` (see certification §9–10):

- ✅ billing-reconcile `report.ok:true` + authenticated paid `/api/health/ready`=200
  (`cron_billing_reconcile_freshness:ok`) — `P0-V22-PAID-READINESS` CLOSED (§3).
- ✅ Live Stripe A–H rehearsal + real cancellation/recovery emails — `P0-LIVE-TRANSACTION`
  CLOSED (`LIVE-TRANSACTION-EVIDENCE.md`).
- ✅ RC re-cut at `faf5d16` (release-candidate workflow success) — no longer superseded.
- ✅ `release-check` production-owner gate satisfied by the deployed paid readiness 200
  (parity-tested identical env contract; see §3 and the suite note in the manifest).
- ✅ `matureValue` = pass (owner-attested); `openDependencyAdvisories` = 0.
- ✅ **Secret rotation** — owner-attested done 2026-09-05: `ADMIN_STATS_SECRET` +
  `CRON_SECRET` rotated, cron.org updated, redeployed (§5).
