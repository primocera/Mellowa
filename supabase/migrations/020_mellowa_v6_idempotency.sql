-- Mellowa v6 — Launch Prompt 7: idempotent, concurrency-safe generation.
-- Run in Supabase SQL Editor after 019_mellowa_v5_feedback_verdicts.sql.

-- One row per intentional generation attempt. The unique key makes double
-- clicks, network retries and concurrent duplicates converge on one claim,
-- so at most one provider call runs per intentional request.
create table if not exists public.generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  route text not null,
  idempotency_key text not null,
  local_date date,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'succeeded', 'failed')),
  result_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, route, idempotency_key)
);

alter table public.generation_requests enable row level security;

create policy "generation_requests_own"
  on public.generation_requests for select
  using (auth.uid() = user_id);

create index if not exists generation_requests_user_route_idx
  on public.generation_requests (user_id, route, created_at desc);

-- Atomic claim. Returns:
--   { claimed: true,  request_id }                       → caller may generate
--   { claimed: false, status, result_id }                → duplicate request
-- Stale in_progress rows older than p_stale_minutes are re-claimed so a
-- crashed worker can never lock a user out of the day.
create or replace function public.claim_generation_request(
  p_user_id uuid,
  p_route text,
  p_idempotency_key text,
  p_local_date date,
  p_stale_minutes int default 5
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.generation_requests%rowtype;
begin
  -- Authenticated callers may only claim for themselves (service role is
  -- trusted — used by server routes and dev bypass).
  if auth.role() = 'authenticated' and auth.uid() is distinct from p_user_id then
    raise exception 'claim for another user is not allowed';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_route || ':' || p_idempotency_key, 0)
  );

  select * into v_row
  from public.generation_requests
  where user_id = p_user_id
    and route = p_route
    and idempotency_key = p_idempotency_key;

  if found then
    -- Failed attempts and stale in-progress claims may be retried; a
    -- succeeded or live in-progress claim never generates twice.
    if v_row.status = 'failed'
       or (v_row.status = 'in_progress'
           and v_row.updated_at < now() - make_interval(mins => p_stale_minutes)) then
      update public.generation_requests
        set status = 'in_progress', updated_at = now()
        where id = v_row.id;
      return jsonb_build_object('claimed', true, 'request_id', v_row.id);
    end if;
    return jsonb_build_object(
      'claimed', false,
      'status', v_row.status,
      'result_id', v_row.result_id
    );
  end if;

  insert into public.generation_requests
    (user_id, route, idempotency_key, local_date)
  values (p_user_id, p_route, p_idempotency_key, p_local_date)
  returning * into v_row;

  return jsonb_build_object('claimed', true, 'request_id', v_row.id);
end;
$$;

create or replace function public.finish_generation_request(
  p_request_id uuid,
  p_user_id uuid,
  p_status text,
  p_result_id uuid default null
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
  update public.generation_requests
    set status = p_status, result_id = p_result_id, updated_at = now()
    where id = p_request_id and user_id = p_user_id;
end;
$$;

revoke all on function public.claim_generation_request(uuid, text, text, date, int) from public;
revoke all on function public.finish_generation_request(uuid, uuid, text, uuid) from public;
grant execute on function public.claim_generation_request(uuid, text, text, date, int) to service_role, authenticated;
grant execute on function public.finish_generation_request(uuid, uuid, text, uuid) to service_role, authenticated;
