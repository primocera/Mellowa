-- MW-04 (v20): exact-schema readiness probe.
--
-- Deep readiness previously proved migration 049 only by SELECTing the
-- `superseded_at` COLUMN — a column can exist while the partial unique index
-- that actually enforces "one canonical plan per user/day" does not. Likewise
-- the MW-01 completion parent-ownership policy and the MW-02 claim objects had
-- no exact probe. This side-effect-free, read-only SECURITY DEFINER function
-- returns exact-object existence booleans from the catalog so /api/health/ready
-- can fail closed when the precise invariant is missing, not merely a column.
--
-- Read-only: it never writes, never runs a generation, never touches user data.

create or replace function public.readiness_schema_probe()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    -- 049: the PARTIAL UNIQUE index (predicate on superseded_at is null), not
    -- just the column.
    'daily_plans_canonical_index', exists (
      select 1 from pg_indexes
       where schemaname = 'public'
         and tablename = 'daily_plans'
         and indexname = 'daily_plans_user_date_canonical'
         and indexdef ilike '%superseded_at is null%'
         and indexdef ilike '%unique%'
    ),
    -- MW-01 (050): the plan_completions INSERT policy enforces parent ownership
    -- (its WITH CHECK references daily_plans).
    'plan_completions_parent_ownership', exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename = 'plan_completions'
         and cmd = 'INSERT'
         and coalesce(with_check, '') ilike '%daily_plans%'
    ),
    -- MW-02 (051): the atomic day-scoped claim table + RPCs.
    'daily_plan_claims_table',
      to_regclass('public.daily_plan_generation_claims') is not null,
    'claim_daily_plan_fn', exists (
      select 1 from pg_proc where proname = 'claim_daily_plan_generation'
    ),
    'finish_daily_plan_fn', exists (
      select 1 from pg_proc where proname = 'finish_daily_plan_generation'
    )
  );
$$;

revoke all on function public.readiness_schema_probe() from public;
grant execute on function public.readiness_schema_probe() to service_role;

-- VERIFICATION (all values true after 049/050/051 are applied):
--   select public.readiness_schema_probe();
--
-- Rollback:
--   drop function if exists public.readiness_schema_probe();
