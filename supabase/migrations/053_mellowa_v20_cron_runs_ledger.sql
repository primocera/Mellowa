-- MW-05 (v20): durable cron run ledger.
--
-- The cron registry declared each job's schedule, lease and freshness, but the
-- only durable run evidence lived inside two subsystems (account-deletion stats,
-- email outbox). retention and billing-reconcile had NO durable run record and
-- did not even acquire the lease the registry claimed. This ledger makes every
-- registered job's execution observable and lets readiness consume a real
-- last-success — instead of trusting metadata.
--
-- Privacy: the ledger stores a job id, a run id, status, counts, a SAFE error
-- CATEGORY (never a message, id, address or content), timings, the lease
-- outcome and the release sha. No recipient or wellbeing data, ever.

create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  run_id text not null,
  status text not null
    check (status in ('running', 'success', 'failure', 'skipped_locked', 'lease_unavailable', 'degraded')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  processed integer,
  error_category text,   -- safe category only (e.g. 'db_error', 'provider_error')
  lease_outcome text,    -- acquired | skipped | unavailable | delegated | not_applicable
  release_sha text,
  created_at timestamptz not null default now()
);

create index if not exists cron_runs_job_started_idx
  on public.cron_runs (job_id, started_at desc);
create index if not exists cron_runs_job_status_idx
  on public.cron_runs (job_id, status, completed_at desc);

alter table public.cron_runs enable row level security;
-- No policies: only the service role (background routes / readiness) may read/write.

-- Record the start of a run. Returns the ledger row id.
create or replace function public.record_cron_run_start(
  p_job_id text,
  p_run_id text,
  p_release_sha text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.cron_runs (job_id, run_id, status, release_sha)
  values (p_job_id, p_run_id, 'running', p_release_sha)
  returning id into v_id;
  return v_id;
end;
$$;

-- Finalize a run. duration is computed from started_at.
create or replace function public.record_cron_run_finish(
  p_id uuid,
  p_status text,
  p_processed integer default null,
  p_error_category text default null,
  p_lease_outcome text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('success', 'failure', 'skipped_locked', 'lease_unavailable', 'degraded') then
    raise exception 'invalid cron run status %', p_status;
  end if;
  update public.cron_runs
     set status = p_status,
         completed_at = now(),
         duration_ms = greatest(0, (extract(epoch from (now() - started_at)) * 1000)::int),
         processed = coalesce(p_processed, processed),
         error_category = p_error_category,
         lease_outcome = coalesce(p_lease_outcome, lease_outcome)
   where id = p_id;
end;
$$;

-- Per-job health: the most recent run, the most recent SUCCESS and the most
-- recent FAILURE. Readiness turns last_success_at into a freshness verdict; the
-- admin view renders counts/categories only.
create or replace function public.cron_job_health()
returns table (
  job_id text,
  last_run_at timestamptz,
  last_status text,
  last_success_at timestamptz,
  last_failure_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (job_id) job_id, started_at as last_run_at, status as last_status
      from public.cron_runs
     order by job_id, started_at desc
  ),
  ok as (
    select distinct on (job_id) job_id, completed_at as last_success_at
      from public.cron_runs
     where status = 'success'
     order by job_id, completed_at desc
  ),
  bad as (
    select distinct on (job_id) job_id, completed_at as last_failure_at
      from public.cron_runs
     where status = 'failure'
     order by job_id, completed_at desc
  )
  select l.job_id, l.last_run_at, l.last_status, ok.last_success_at, bad.last_failure_at
    from latest l
    left join ok on ok.job_id = l.job_id
    left join bad on bad.job_id = l.job_id;
$$;

revoke all on function public.record_cron_run_start(text, text, text) from public;
revoke all on function public.record_cron_run_finish(uuid, text, integer, text, text) from public;
revoke all on function public.cron_job_health() from public;
grant execute on function public.record_cron_run_start(text, text, text) to service_role;
grant execute on function public.record_cron_run_finish(uuid, text, integer, text, text) to service_role;
grant execute on function public.cron_job_health() to service_role;

-- VERIFICATION:
--   select * from public.cron_job_health();  -- one row per job that has run
--
-- Rollback (data-safe):
--   drop function if exists public.cron_job_health();
--   drop function if exists public.record_cron_run_finish(uuid, text, integer, text, text);
--   drop function if exists public.record_cron_run_start(text, text, text);
--   drop table if exists public.cron_runs;
