-- Verify migrations 050–054 (Mellowa v20) landed correctly.
-- Run in the Supabase SQL editor (prod ref rxciojzhzqdcvrcfkgho) or via psql.
-- Every row should say PASS. Any FAIL = that object did not go through.

with checks as (

  ----------------------------------------------------------------------------
  -- 050  plan_completions parent-ownership RLS
  ----------------------------------------------------------------------------
  select '050' as mig, 'insert policy enforces parent ownership' as check_name,
    exists (
      select 1 from pg_policies
       where schemaname='public' and tablename='plan_completions'
         and cmd='INSERT' and coalesce(with_check,'') ilike '%daily_plans%'
    ) as ok
  union all
  select '050', 'update policy exists (idempotent upsert path)',
    exists (
      select 1 from pg_policies
       where schemaname='public' and tablename='plan_completions'
         and policyname='plan_completions_update_own' and cmd='UPDATE'
    )
  union all
  select '050', 'no cross-owner completions remain (repair applied)',
    not exists (
      select 1 from public.plan_completions pc
       join public.daily_plans dp on dp.id = pc.daily_plan_id
      where pc.user_id <> dp.user_id
    )

  ----------------------------------------------------------------------------
  -- 051  atomic daily-plan generation claim
  ----------------------------------------------------------------------------
  union all
  select '051', 'daily_plan_generation_claims table exists',
    to_regclass('public.daily_plan_generation_claims') is not null
  union all
  select '051', 'owner_request_id fencing column exists',
    exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='daily_plan_generation_claims'
         and column_name='owner_request_id'
    )
  union all
  select '051', 'RLS enabled on claims table',
    coalesce((select relrowsecurity from pg_class
               where oid = to_regclass('public.daily_plan_generation_claims')), false)
  union all
  select '051', 'claim_daily_plan_generation() exists',
    exists (select 1 from pg_proc where proname='claim_daily_plan_generation')
  union all
  select '051', 'finish_daily_plan_generation() exists',
    exists (select 1 from pg_proc where proname='finish_daily_plan_generation')

  ----------------------------------------------------------------------------
  -- 052  readiness schema probe (and what it asserts)
  ----------------------------------------------------------------------------
  union all
  select '052', 'readiness_schema_probe() exists',
    exists (select 1 from pg_proc where proname='readiness_schema_probe')
  union all
  select '052', 'probe reports all invariants true',
    coalesce((
      select bool_and(value::boolean)
        from jsonb_each_text(public.readiness_schema_probe())
    ), false)
  union all
  select '052', '049 partial-unique canonical index present (predicate)',
    exists (
      select 1 from pg_indexes
       where schemaname='public' and tablename='daily_plans'
         and indexname='daily_plans_user_date_canonical'
         and indexdef ilike '%superseded_at is null%'
         and indexdef ilike '%unique%'
    )

  ----------------------------------------------------------------------------
  -- 053  cron run ledger
  ----------------------------------------------------------------------------
  union all
  select '053', 'cron_runs table exists',
    to_regclass('public.cron_runs') is not null
  union all
  select '053', 'RLS enabled on cron_runs',
    coalesce((select relrowsecurity from pg_class
               where oid = to_regclass('public.cron_runs')), false)
  union all
  select '053', 'record_cron_run_start() exists',
    exists (select 1 from pg_proc where proname='record_cron_run_start')
  union all
  select '053', 'record_cron_run_finish() exists',
    exists (select 1 from pg_proc where proname='record_cron_run_finish')
  union all
  select '053', 'cron_job_health() exists',
    exists (select 1 from pg_proc where proname='cron_job_health')

  ----------------------------------------------------------------------------
  -- 054  support ingestion runs
  ----------------------------------------------------------------------------
  union all
  select '054', 'support_ingestion_runs table exists',
    to_regclass('public.support_ingestion_runs') is not null
  union all
  select '054', 'RLS enabled on support_ingestion_runs',
    coalesce((select relrowsecurity from pg_class
               where oid = to_regclass('public.support_ingestion_runs')), false)
  union all
  select '054', 'coverage_end column exists (staleness driver)',
    exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='support_ingestion_runs'
         and column_name='coverage_end'
    )
)
select mig, check_name, case when ok then 'PASS' else 'FAIL' end as result
  from checks
 order by mig, check_name;
