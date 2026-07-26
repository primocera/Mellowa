-- MW-V10-05 (v10): cron run leases.
--
-- The email ledger's unique event key already makes duplicate SENDS impossible.
-- What it does not prevent is two overlapping runs of the same job doing all
-- the work twice: both scan every profile, both call the provider, both burn
-- the time budget, and the second one's sends collapse into "duplicate" only
-- after the request has been made. On a delayed or retried cron trigger — which
-- Vercel does not promise never happens — that is wasted spend and doubled
-- provider load for no benefit.
--
-- A lease makes a second concurrent run a no-op instead. It is a coarse,
-- deliberately simple lock:
--   * one row per job name;
--   * a run acquires it only if no unexpired lease exists;
--   * the lease expires on its own, so a crashed run cannot wedge the job
--     forever — the next trigger after expiry takes over.
--
-- This is belt-and-braces, not the primary guarantee. Idempotency still comes
-- from the ledger; the lease only stops the duplicated work.

create table if not exists public.cron_leases (
  job_name text primary key,
  leased_until timestamptz not null,
  leased_at timestamptz not null default now(),
  -- Opaque run id for correlating logs. No user data, ever.
  run_id text
);

alter table public.cron_leases enable row level security;
-- No policies: the service role bypasses RLS, and nothing else may read this.

/**
 * Acquire the lease for `p_job_name` for `p_ttl_seconds`.
 * Returns true when this caller now holds it, false when someone else does.
 */
create or replace function public.claim_cron_run(
  p_job_name text,
  p_ttl_seconds int,
  p_run_id text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  -- ON CONFLICT ... WHERE makes acquire-or-fail a single atomic statement, so
  -- two runs starting in the same millisecond cannot both win.
  insert into public.cron_leases (job_name, leased_until, leased_at, run_id)
  values (p_job_name, now() + make_interval(secs => p_ttl_seconds), now(), p_run_id)
  on conflict (job_name) do update
    set leased_until = excluded.leased_until,
        leased_at = excluded.leased_at,
        run_id = excluded.run_id
    where public.cron_leases.leased_until < now()
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

/**
 * Release the lease early, so a fast run does not block the next trigger for
 * the whole TTL. Releasing a lease you do not hold is a no-op, not an error.
 */
create or replace function public.release_cron_run(
  p_job_name text,
  p_run_id text
) returns void
language sql
security definer
set search_path = public
as $$
  update public.cron_leases
  set leased_until = now()
  where job_name = p_job_name and run_id = p_run_id;
$$;

revoke all on function public.claim_cron_run(text, int, text) from public, anon, authenticated;
revoke all on function public.release_cron_run(text, text) from public, anon, authenticated;

comment on table public.cron_leases is
  'MW-V10-05: coarse per-job run lease. Prevents duplicated WORK on overlapping cron runs; duplicate SENDS are prevented by email_deliveries.event_key.';
