-- MW-V9-10 (v9): monthly fair-use abuse cap for AI generation.
--
-- The existing claim_ai_generation enforces per-hour, per-day and a global
-- daily spend ceiling. Those protect the system in a spike but a single account
-- generating at the daily limit every day (40/day ≈ 1200/month) would exceed
-- the economics of a €59.99/year plan. This additive OVERLOAD adds an explicit,
-- generous per-billing-period cap counted from the same ledger, in the same
-- atomic advisory-locked path, so a retry can never double-count. The original
-- six-argument function is unchanged; callers opt in by passing p_per_month.
-- A very high p_per_month (or leaving callers on the old signature) is a no-op,
-- so the app-level flag can disable the cap without a deploy.

create or replace function public.claim_ai_generation(
  p_user_id uuid,
  p_route text,
  p_per_hour int,
  p_per_day int,
  p_per_month int,
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
  v_month_count int;
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

  -- Monthly abuse cap: count real generations in the trailing 30 days,
  -- excluding released reservations (no provider call, no cost).
  select count(*) into v_month_count
  from public.ai_usage_events
  where user_id = p_user_id
    and created_at >= now() - interval '30 days'
    and status <> 'released';
  if v_month_count >= p_per_month then
    return jsonb_build_object('allowed', false, 'reason', 'month');
  end if;

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

-- Same locked-down grants as the six-arg function: service-role only, so
-- limits and cost can never be caller-chosen from the client.
revoke all on function public.claim_ai_generation(uuid, text, int, int, int, numeric, numeric) from public;
revoke all on function public.claim_ai_generation(uuid, text, int, int, int, numeric, numeric) from anon;
revoke all on function public.claim_ai_generation(uuid, text, int, int, int, numeric, numeric) from authenticated;
grant execute on function public.claim_ai_generation(uuid, text, int, int, int, numeric, numeric) to service_role;
