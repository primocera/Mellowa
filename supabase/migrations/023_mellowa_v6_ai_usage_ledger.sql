-- Mellowa v6 — Launch Prompt 11: auditable AI usage ledger.
-- Run in Supabase SQL Editor after 022_mellowa_v6_analytics_contract.sql.
--
-- Turns the reservation estimate (migration 010) into an auditable ledger with
-- provider token truth and outcome status. A row is inserted 'reserved' at
-- claim time and finalized after the call with actual tokens, actual cost,
-- latency and outcome. Raw prompts/responses are NEVER stored here.

alter table public.ai_usage_events
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists prompt_version text,
  add column if not exists actual_cost_usd numeric(10,6),
  add column if not exists status text not null default 'reserved',
  add column if not exists latency_ms integer,
  add column if not exists retry_count integer not null default 0,
  add column if not exists fallback_used boolean not null default false,
  add column if not exists result_id uuid;

-- Cheap scans for ops: outcomes over time and per-route spend.
create index if not exists ai_usage_events_status_idx
  on public.ai_usage_events (status, created_at desc);
create index if not exists ai_usage_events_route_idx
  on public.ai_usage_events (route, created_at desc);

-- Recreate the claim so the global daily ceiling counts ACTUAL spend once known,
-- falling back to the reservation estimate for rows still in flight. This is
-- what stops a user being blocked with a capacity message merely because the
-- estimate drifted above reality. Rows are explicitly marked 'reserved'.
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

  -- Actual spend where finalized, else the reservation estimate. Released
  -- reservations (no provider call) contribute nothing.
  select coalesce(sum(
    case
      when status = 'released' then 0
      else coalesce(actual_cost_usd, estimated_cost_usd)
    end
  ), 0) into v_global_today
  from public.ai_usage_events
  where created_at >= date_trunc('day', now());

  if v_global_today >= p_global_daily_ceiling then
    return jsonb_build_object('allowed', false, 'reason', 'global');
  end if;

  insert into public.ai_usage_events (user_id, route, estimated_cost_usd, status)
  values (p_user_id, p_route, p_est_cost, 'reserved')
  returning id into v_event_id;

  return jsonb_build_object('allowed', true, 'event_id', v_event_id);
end;
$$;

grant execute on function public.claim_ai_generation(
  uuid, text, int, int, numeric, numeric
) to authenticated, service_role;

-- Finalize a reserved row with provider truth and outcome. Scoped to the row's
-- owner. Only advances a row out of 'reserved' (idempotent-ish: a second call
-- with the same status is harmless). SECURITY DEFINER; service-role callers.
create or replace function public.finalize_ai_usage(
  p_event_id uuid,
  p_status text,
  p_provider text default null,
  p_model text default null,
  p_prompt_version text default null,
  p_input_tokens int default 0,
  p_output_tokens int default 0,
  p_actual_cost_usd numeric default null,
  p_latency_ms int default null,
  p_retry_count int default 0,
  p_fallback_used boolean default false,
  p_result_id uuid default null
) returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_usage_events
    set status = p_status,
        provider = coalesce(p_provider, provider),
        model = coalesce(p_model, model),
        prompt_version = coalesce(p_prompt_version, prompt_version),
        input_tokens = p_input_tokens,
        output_tokens = p_output_tokens,
        actual_cost_usd = p_actual_cost_usd,
        latency_ms = p_latency_ms,
        retry_count = p_retry_count,
        fallback_used = p_fallback_used,
        result_id = p_result_id
  where id = p_event_id;
$$;

revoke all on function public.finalize_ai_usage(
  uuid, text, text, text, text, int, int, numeric, int, int, boolean, uuid
) from public;
grant execute on function public.finalize_ai_usage(
  uuid, text, text, text, text, int, int, numeric, int, int, boolean, uuid
) to service_role;
