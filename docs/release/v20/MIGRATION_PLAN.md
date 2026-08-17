# v20 — Migration & Deployment Plan (MW-08)

> Owner-executed. **Claude Code does not apply production migrations, use the
> production Supabase/Stripe, or promote the manifest.** This plan is prepared and
> validated only. Every v20 migration is additive and idempotent with a data-safe
> rollback.

## Scope
New migrations this release: **050–054** (on top of 001–049 already present).

| # | File | Adds | Required by |
|---|---|---|---|
| 050 | `050_mellowa_v20_completion_parent_ownership.sql` | plan_completions parent-ownership RLS (INSERT/UPDATE) + deterministic repair | MW-01 completion route |
| 051 | `051_mellowa_v20_daily_plan_claim.sql` | `daily_plan_generation_claims` + claim/finish RPCs | MW-02 daily-plan route |
| 052 | `052_mellowa_v20_readiness_schema_probe.sql` | read-only `readiness_schema_probe()` | MW-04 paid readiness |
| 053 | `053_mellowa_v20_cron_runs_ledger.sql` | `cron_runs` + start/finish/health RPCs | MW-05 cron helper + readiness |
| 054 | `054_mellowa_v20_support_ingestion_runs.sql` | `support_ingestion_runs` | MW-07 support ingestion |

## Deployment ordering invariant (fail closed)
Code that requires a migration must NOT be deployed before the schema exists:

- 052's `readiness_schema_probe()` verifies 049's partial unique index, 050's
  ownership policy and 051's claim objects. **Apply 050 + 051 + 049 before (or
  with) 052**, or paid readiness will (correctly) report `fail` for the missing
  invariants and block.
- 051 must be applied before the MW-02 daily-plan route is live in paid readiness,
  or `schema_daily_plan_claims_table/_fn` report `fail`.
- 053 must be applied before the cron helper runs in production, or every job's
  `record_cron_run_*` call errors (the helper degrades gracefully, but readiness
  `cron_*_freshness` stays `unavailable`).

**Rule:** run the migrations, then deploy the code, then confirm
`/api/health/ready` (paid mode) is 200 before opening any paid tier.

## Owner sequence (per migration: preflight → apply → verify → rollback)

Run in a disposable Supabase first (clean baseline AND a representative
previous-version fixture with duplicate/inconsistent rows), then production.

### 0. Backup / preflight
- Take a Supabase backup / export of `daily_plans`, `plan_completions`,
  `subscriptions` before applying (050 performs a deterministic repair delete).

### 050 — completion parent ownership
- **Preflight (scope of the repair):**
  ```sql
  select count(*) from public.plan_completions pc
    join public.daily_plans dp on dp.id = pc.daily_plan_id
   where pc.user_id <> dp.user_id;
  ```
- **Apply:** run `050_mellowa_v20_completion_parent_ownership.sql`. It emits a
  `RAISE NOTICE` with the number of invalid rows deleted.
- **Verify (must be 0):**
  ```sql
  select count(*) from public.plan_completions pc
    join public.daily_plans dp on dp.id = pc.daily_plan_id
   where pc.user_id <> dp.user_id;
  ```
- **Rollback:** drop the new policies and restore the original insert policy (see
  file footer). The repair delete of illegitimate rows is intentionally not reversed.

### 051 — daily-plan claim
- **Preflight:** none (new table + functions).
- **Apply:** run the file.
- **Verify:**
  ```sql
  select proname from pg_proc
   where proname in ('claim_daily_plan_generation','finish_daily_plan_generation'); -- 2 rows
  select to_regclass('public.daily_plan_generation_claims');                        -- not null
  ```
- **Rollback:** drop the two functions and the table (file footer).

### 052 — readiness schema probe
- **Preflight:** apply 049 + 050 + 051 first.
- **Apply:** run the file.
- **Verify (every value true):**
  ```sql
  select public.readiness_schema_probe();
  ```
- **Rollback:** `drop function if exists public.readiness_schema_probe();`

### 053 — cron runs ledger
- **Apply:** run the file.
- **Verify:**
  ```sql
  select * from public.cron_job_health();  -- empty until a job runs; no error
  ```
- **Rollback:** drop the health function, the two record functions, then the table.

### 054 — support ingestion runs
- **Apply:** run the file.
- **Verify:**
  ```sql
  select count(*) from public.support_ingestion_runs;  -- 0, no error
  ```
- **Rollback:** `drop table if exists public.support_ingestion_runs;`

## Post-apply readiness gate
1. Deploy the v20 code (owner).
2. `curl -H "Authorization: Bearer $ADMIN_STATS_SECRET" https://mellowa.app/api/health/ready`
   with `READINESS_MODE=paid` must be **200** — the exact-schema probe (052),
   config components (MW-04) and ledger freshness (MW-05) all pass.
3. Only then cut the immutable RC (release-candidate workflow) and run the
   authenticated matrix against a disposable Supabase with 050-054 applied.

## What remains OWNER-ONLY (NOT RUN)
- Applying 050-054 to production.
- Cutting/promoting the immutable RC (P0-V20-RC-NOT-CUT).
- The authenticated E2E matrix at a v20 SHA (P1-V20-AUTH-E2E-AT-HEAD).
- Live billing/email/reminder/outbox/cron/deletion rehearsals (MW-09).
