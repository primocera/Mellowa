-- MW-02 (v20): atomic PRE-provider daily-plan generation claim.
--
-- Until now daily-plan de-duplication had two layers, both AFTER cost:
--   * a check-then-act pre-read of the canonical plan (racy), and
--   * the idempotency claim keyed by (user_id, route, idempotency_key) — so two
--     concurrent requests with DIFFERENT idempotency keys both claimed and both
--     called the provider; migration 049's partial unique index then rejected
--     only the losing INSERT, AFTER the provider spend was already incurred.
--
-- This migration adds a claim that is atomic and keyed by the canonical unit of
-- work — (user_id, local_date) — independent of the idempotency key, acquired
-- BEFORE any usage reservation, check-in write or provider invocation. Exactly
-- one request per user per local day may hold the claim and call the provider;
-- everyone else is a follower (canonical result if done, in_progress while the
-- lease is live, or a safe reclaim only after the lease expires).
--
-- The claim RPC runs as a SHORT transaction (advisory lock + upsert) and returns
-- immediately — the external provider call happens in the route, OUTSIDE any DB
-- transaction, so no long transaction is ever held open across the network.
-- migration 049's partial unique index remains as a data-integrity backstop; a
-- 23505 becomes an exceptional recovery path, not the normal dedup mechanism.
--
-- Additive and idempotent.

create table if not exists public.daily_plan_generation_claims (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  status text not null default 'claimed'
    check (status in ('claimed', 'succeeded', 'failed')),
  -- Fencing token: only the holder of the CURRENT lease may finish the claim,
  -- so a crashed-then-resumed winner cannot clobber a follower that already
  -- reclaimed an expired lease.
  owner_request_id uuid not null default gen_random_uuid(),
  attempt int not null default 1,
  lease_expires_at timestamptz not null,
  result_id uuid,          -- the daily_plans row this generation produced
  failure_code text,       -- safe category only; never provider/PII detail
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

alter table public.daily_plan_generation_claims enable row level security;

drop policy if exists "daily_plan_generation_claims_select_own"
  on public.daily_plan_generation_claims;
create policy "daily_plan_generation_claims_select_own"
  on public.daily_plan_generation_claims for select
  using (auth.uid() = user_id);

-- Atomic claim. Returns one of:
--   { outcome: 'claimed',  owner_request_id, attempt, reclaimed }  → caller generates
--   { outcome: 'in_progress', retry_after_seconds }                → live winner elsewhere
--   { outcome: 'duplicate', status: 'succeeded', result_id }       → already generated
create or replace function public.claim_daily_plan_generation(
  p_user_id uuid,
  p_local_date date,
  p_lease_seconds int default 120
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.daily_plan_generation_claims%rowtype;
  v_token uuid;
begin
  if auth.role() = 'authenticated' and auth.uid() is distinct from p_user_id then
    raise exception 'claim for another user is not allowed';
  end if;

  -- Serialize concurrent claimants for this exact (user, local date).
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':daily-plan:' || p_local_date::text, 0)
  );

  select * into v_row
    from public.daily_plan_generation_claims
   where user_id = p_user_id and local_date = p_local_date;

  if found then
    if v_row.status = 'succeeded' then
      return jsonb_build_object(
        'outcome', 'duplicate', 'status', 'succeeded', 'result_id', v_row.result_id
      );
    end if;

    -- A live lease means another request is generating right now.
    if v_row.status = 'claimed' and v_row.lease_expires_at > now() then
      return jsonb_build_object(
        'outcome', 'in_progress',
        'retry_after_seconds',
        greatest(1, ceil(extract(epoch from (v_row.lease_expires_at - now())))::int)
      );
    end if;

    -- Failed, or a crashed winner whose lease expired: safe to reclaim.
    v_token := gen_random_uuid();
    update public.daily_plan_generation_claims
       set status = 'claimed',
           owner_request_id = v_token,
           attempt = v_row.attempt + 1,
           lease_expires_at = now() + make_interval(secs => p_lease_seconds),
           result_id = null,
           failure_code = null,
           updated_at = now()
     where user_id = p_user_id and local_date = p_local_date;
    return jsonb_build_object(
      'outcome', 'claimed', 'owner_request_id', v_token,
      'attempt', v_row.attempt + 1, 'reclaimed', true
    );
  end if;

  -- First claimant for this local day.
  insert into public.daily_plan_generation_claims
    (user_id, local_date, lease_expires_at)
  values
    (p_user_id, p_local_date, now() + make_interval(secs => p_lease_seconds))
  returning * into v_row;

  return jsonb_build_object(
    'outcome', 'claimed', 'owner_request_id', v_row.owner_request_id,
    'attempt', 1, 'reclaimed', false
  );
end;
$$;

-- Finalize the claim. Only the current lease holder (matching owner_request_id)
-- may transition it, so a stale winner cannot overwrite a follower's reclaim.
create or replace function public.finish_daily_plan_generation(
  p_user_id uuid,
  p_local_date date,
  p_owner_request_id uuid,
  p_status text,
  p_result_id uuid default null,
  p_failure_code text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' and auth.uid() is distinct from p_user_id then
    raise exception 'finish for another user is not allowed';
  end if;
  if p_status not in ('succeeded', 'failed') then
    raise exception 'invalid status %', p_status;
  end if;
  update public.daily_plan_generation_claims
     set status = p_status,
         result_id = case when p_status = 'succeeded' then p_result_id else result_id end,
         failure_code = case when p_status = 'failed' then p_failure_code else null end,
         updated_at = now()
   where user_id = p_user_id
     and local_date = p_local_date
     and owner_request_id = p_owner_request_id;
end;
$$;

revoke all on function public.claim_daily_plan_generation(uuid, date, int) from public;
revoke all on function public.finish_daily_plan_generation(uuid, date, uuid, text, uuid, text) from public;
grant execute on function public.claim_daily_plan_generation(uuid, date, int)
  to service_role, authenticated;
grant execute on function public.finish_daily_plan_generation(uuid, date, uuid, text, uuid, text)
  to service_role, authenticated;

-- VERIFICATION:
--   select proname from pg_proc where proname in
--     ('claim_daily_plan_generation','finish_daily_plan_generation');  -- 2 rows
--
-- Rollback (data-safe):
--   drop function if exists public.finish_daily_plan_generation(uuid, date, uuid, text, uuid, text);
--   drop function if exists public.claim_daily_plan_generation(uuid, date, int);
--   drop table if exists public.daily_plan_generation_claims;
