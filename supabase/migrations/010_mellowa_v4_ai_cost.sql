-- Mellowa v4 — Prompt 16: atomic AI usage limits, cost ledger, global ceiling.
-- Run in Supabase SQL Editor after 009_mellowa_v4_onboarding_prefs.sql.

-- Cost ledger columns on the existing usage table.
alter table public.ai_usage_events
  add column if not exists input_tokens int not null default 0,
  add column if not exists output_tokens int not null default 0,
  add column if not exists estimated_cost_usd numeric(10,6) not null default 0;

-- Index to make the global daily-cost sum cheap.
create index if not exists ai_usage_events_created_idx
  on public.ai_usage_events (created_at);

-- Atomic claim: checks the per-user hourly/daily limits AND the global daily
-- spend ceiling, then reserves the slot by inserting a ledger row — all under a
-- per-user advisory lock so concurrent requests can't race past the limit.
-- SECURITY DEFINER so it can read/write regardless of RLS; scoped to one user.
create or replace function public.claim_ai_generation(
  p_user_id uuid,
  p_route text,
  p_per_hour int,
  p_per_day int,
  p_est_cost numeric,
  p_global_daily_ceiling numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hour_count int;
  v_day_count int;
  v_global_today numeric;
  v_event_id uuid;
begin
  -- Serialize concurrent claims for this user.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select count(*) into v_hour_count
  from public.ai_usage_events
  where user_id = p_user_id and created_at >= now() - interval '1 hour';

  if v_hour_count >= p_per_hour then
    return jsonb_build_object('allowed', false, 'reason', 'hour');
  end if;

  select count(*) into v_day_count
  from public.ai_usage_events
  where user_id = p_user_id and created_at >= now() - interval '24 hours';

  if v_day_count >= p_per_day then
    return jsonb_build_object('allowed', false, 'reason', 'day');
  end if;

  select coalesce(sum(estimated_cost_usd), 0) into v_global_today
  from public.ai_usage_events
  where created_at >= date_trunc('day', now());

  if v_global_today >= p_global_daily_ceiling then
    return jsonb_build_object('allowed', false, 'reason', 'global');
  end if;

  insert into public.ai_usage_events (user_id, route, estimated_cost_usd)
  values (p_user_id, p_route, p_est_cost)
  returning id into v_event_id;

  return jsonb_build_object('allowed', true, 'event_id', v_event_id);
end;
$$;

grant execute on function public.claim_ai_generation(
  uuid, text, int, int, numeric, numeric
) to authenticated, service_role;
