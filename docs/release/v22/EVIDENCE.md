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

## Still NOT RUN (owner)

Recorded here only when direct evidence exists:

- RC cut at a v22 SHA (`release-candidate.yml`) + authenticated E2E matrix.
- `cron_billing_reconcile_freshness=ok` (durable `cron_runs` success).
- Secret rotation (date + creds, no values).
- Deploy + authenticated `/api/health/ready` (paid) = 200 on the deployed SHA.
- Live Stripe rehearsal + one real transactional email with replay idempotency.
