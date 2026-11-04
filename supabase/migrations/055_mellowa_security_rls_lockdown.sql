-- 055: lock down user-writable billing, metering and safety state.
--
-- Mellowa talks to Supabase with the anon key + the user's session, so RLS and
-- function grants are the real security boundary. A review found that a
-- signed-in user could, from the browser console:
--
--   * subscriptions: insert/update/delete their own row (001 loop) → set
--     status='active' for free Premium, clear trial_used_at / delete the row for
--     a second trial, pin trial_days=31, or set last_stripe_event_created huge
--     so every later webhook is ignored.
--   * profiles: delete their own row → ON DELETE CASCADE wipes subscriptions,
--     daily_plans, ai_usage_events, onboarding_completions … (full reset of
--     trial, sample and fair use), then re-insert it.
--   * ai_usage_events: insert a row with any cost (004) → the global daily
--     ceiling in claim_ai_generation sums EVERY user's rows, so one user could
--     block AI for everyone (a future created_at made it permanent).
--   * daily_plans / weekly_plans: delete (or move week_start of) the rows the
--     free-sample and weekly caps count → another free plan.
--   * wellbeing_profiles: set sample_adjustment_used_at back to null, or delete
--     and re-insert the row → another free sample adjustment.
--   * safety_events: update/delete their own rows → re-enable macros after an
--     eating-disorder signal and un-pause reminders after a crisis signal.
--   * plan_feedback / habit_logs: insert rows pointing at ANOTHER user's plan or
--     habit, occupying the global unique slot (the 050 issue, other tables).
--   * SECURITY DEFINER functions revoked only "from public" keep Supabase's
--     default EXECUTE grant to anon/authenticated; the claim/finish functions
--     only checked ownership for role 'authenticated', so anon skipped it.
--   * claim_stripe_event re-claimed rows still in 'processing' → a concurrent
--     duplicate delivery processed the same event twice.
--
-- Everything here is additive and idempotent. RLS stays ENABLED everywhere.
-- service_role (webhook, checkout, cancel, crons, admin routes) bypasses RLS,
-- so the server paths keep working; every app write to the locked tables was
-- verified to go through createAdminClient(), except the ones this release
-- moves (regenerate-section sample claim/refund → admin client).

-- ---------------------------------------------------------------------------
-- 1. subscriptions: read-only for users.
-- ---------------------------------------------------------------------------
drop policy if exists "subscriptions_insert_own" on public.subscriptions;
drop policy if exists "subscriptions_update_own" on public.subscriptions;
drop policy if exists "subscriptions_delete_own" on public.subscriptions;
-- subscriptions_select_own is kept (entitlement is read with the user session).

-- ---------------------------------------------------------------------------
-- 2. profiles: no user insert/delete. handle_new_user() (SECURITY DEFINER
--    trigger on auth.users) creates the row; account deletion runs through the
--    service-role deletion worker. Update stays (display name etc.).
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;

-- ---------------------------------------------------------------------------
-- 3. ai_usage_events: only the service-role claim/finalize functions write the
--    ledger. Select-own is kept.
-- ---------------------------------------------------------------------------
drop policy if exists "ai_usage_events_insert_own" on public.ai_usage_events;

-- Repair: a future-dated row can only have been planted through the dropped
-- policy (created_at defaults to now() on every server insert). Such a row
-- counts toward "today" forever, so it is removed. Implausible costs are
-- reported, not deleted — the owner reviews them with the PREFLIGHT query.
do $$
declare
  v_future bigint;
  v_costly bigint;
begin
  select count(*) into v_future
    from public.ai_usage_events
   where created_at > now() + interval '1 hour';
  if v_future > 0 then
    raise notice '055 repair: deleting % future-dated ai_usage_events rows.', v_future;
    delete from public.ai_usage_events where created_at > now() + interval '1 hour';
  end if;

  select count(*) into v_costly
    from public.ai_usage_events
   where coalesce(actual_cost_usd, estimated_cost_usd, 0) > 1;
  if v_costly > 0 then
    raise notice '055 review: % ai_usage_events rows cost more than $1 — check with the PREFLIGHT query.', v_costly;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. safety_events: written only by the server (check-input.ts, admin client).
--    Users may read their own events (the Today page needs it) but never
--    insert, edit or delete them.
-- ---------------------------------------------------------------------------
drop policy if exists "safety_events_insert_own" on public.safety_events;
drop policy if exists "safety_events_update_own" on public.safety_events;
drop policy if exists "safety_events_delete_own" on public.safety_events;

-- ---------------------------------------------------------------------------
-- 5. Rows the free-sample and weekly caps count must not be removable by the
--    user. The app never deletes daily_plans or weekly_plans with the user
--    client, and never updates weekly_plans with it (insert only).
-- ---------------------------------------------------------------------------
drop policy if exists "daily_plans_delete_own" on public.daily_plans;
drop policy if exists "weekly_plans_update_own" on public.weekly_plans;
drop policy if exists "weekly_plans_delete_own" on public.weekly_plans;

-- ---------------------------------------------------------------------------
-- 6. wellbeing_profiles: no user delete (delete + re-insert reset the sample),
--    and sample_adjustment_used_at can only be changed by the server.
--    The user keeps update for their own preferences (timezone, macros toggle,
--    plan preferences, onboarding upsert) — every other column is unchanged.
-- ---------------------------------------------------------------------------
drop policy if exists "wellbeing_profiles_delete_own" on public.wellbeing_profiles;

-- The trigger function is SECURITY INVOKER on purpose: current_user is then the
-- PostgREST request role (anon / authenticated / service_role).
create or replace function public.guard_sample_adjustment_used_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sample_adjustment_used_at is distinct from old.sample_adjustment_used_at
     and current_user in ('anon', 'authenticated') then
    raise exception 'sample_adjustment_used_at is server-managed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists wellbeing_profiles_guard_sample_adjustment on public.wellbeing_profiles;
create trigger wellbeing_profiles_guard_sample_adjustment
  before update on public.wellbeing_profiles
  for each row execute function public.guard_sample_adjustment_used_at();

revoke all on function public.guard_sample_adjustment_used_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. plan_feedback / habit_logs: parent ownership (same pattern as 050).
-- ---------------------------------------------------------------------------
drop policy if exists "plan_feedback_insert_own" on public.plan_feedback;
create policy "plan_feedback_insert_own" on public.plan_feedback
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.daily_plans dp
       where dp.id = plan_feedback.daily_plan_id
         and dp.user_id = auth.uid()
    )
  );

drop policy if exists "plan_feedback_update_own" on public.plan_feedback;
create policy "plan_feedback_update_own" on public.plan_feedback
  for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.daily_plans dp
       where dp.id = plan_feedback.daily_plan_id
         and dp.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.daily_plans dp
       where dp.id = plan_feedback.daily_plan_id
         and dp.user_id = auth.uid()
    )
  );

drop policy if exists "habit_logs_insert_own" on public.habit_logs;
create policy "habit_logs_insert_own" on public.habit_logs
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.habits h
       where h.id = habit_logs.habit_id
         and h.user_id = auth.uid()
    )
  );

drop policy if exists "habit_logs_update_own" on public.habit_logs;
create policy "habit_logs_update_own" on public.habit_logs
  for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.habits h
       where h.id = habit_logs.habit_id
         and h.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.habits h
       where h.id = habit_logs.habit_id
         and h.user_id = auth.uid()
    )
  );

-- Deterministic repair: rows whose owner differs from the parent's owner are
-- illegitimate by construction (see 050). Delete exactly those; report counts.
do $$
declare
  v_feedback bigint;
  v_logs bigint;
begin
  select count(*) into v_feedback
    from public.plan_feedback pf
    join public.daily_plans dp on dp.id = pf.daily_plan_id
   where pf.user_id <> dp.user_id;
  if v_feedback > 0 then
    raise notice '055 repair: deleting % invalid plan_feedback rows.', v_feedback;
    delete from public.plan_feedback pf
     using public.daily_plans dp
     where dp.id = pf.daily_plan_id and pf.user_id <> dp.user_id;
  end if;

  select count(*) into v_logs
    from public.habit_logs hl
    join public.habits h on h.id = hl.habit_id
   where hl.user_id <> h.user_id;
  if v_logs > 0 then
    raise notice '055 repair: deleting % invalid habit_logs rows.', v_logs;
    delete from public.habit_logs hl
     using public.habits h
     where h.id = hl.habit_id and hl.user_id <> h.user_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. User-callable claim functions: ownership is checked for EVERY role except
--    service_role (before: only for 'authenticated', so anon skipped it), the
--    caller-chosen lease/stale windows are clamped, and anon loses EXECUTE.
--    Bodies are otherwise identical to 020 / 051.
-- ---------------------------------------------------------------------------
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
  -- Only the service role may act for another user; everyone else only for
  -- auth.uid() (anon has no uid, so it can never pass).
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'claim for another user is not allowed';
  end if;
  p_stale_minutes := least(greatest(coalesce(p_stale_minutes, 5), 1), 60);

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_route || ':' || p_idempotency_key, 0)
  );

  select * into v_row
  from public.generation_requests
  where user_id = p_user_id
    and route = p_route
    and idempotency_key = p_idempotency_key;

  if found then
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
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_user_id then
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
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'claim for another user is not allowed';
  end if;
  -- The app uses 120s; a caller can no longer hold a day for decades.
  p_lease_seconds := least(greatest(coalesce(p_lease_seconds, 120), 1), 600);

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

    if v_row.status = 'claimed' and v_row.lease_expires_at > now() then
      return jsonb_build_object(
        'outcome', 'in_progress',
        'retry_after_seconds',
        greatest(1, ceil(extract(epoch from (v_row.lease_expires_at - now())))::int)
      );
    end if;

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
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_user_id then
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

-- These four are called with the user's session (src/lib/ai/idempotency.ts,
-- src/lib/ai/daily-plan-claim.ts), so authenticated keeps EXECUTE.
revoke all on function public.claim_generation_request(uuid, text, text, date, int) from public, anon;
revoke all on function public.finish_generation_request(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.claim_daily_plan_generation(uuid, date, int) from public, anon;
revoke all on function public.finish_daily_plan_generation(uuid, date, uuid, text, uuid, text) from public, anon;
grant execute on function public.claim_generation_request(uuid, text, text, date, int) to authenticated, service_role;
grant execute on function public.finish_generation_request(uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.claim_daily_plan_generation(uuid, date, int) to authenticated, service_role;
grant execute on function public.finish_daily_plan_generation(uuid, date, uuid, text, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. claim_stripe_event: reclaim only failed or stale-lease rows, service-role
--    only. Before, any non-done row (including one being processed right now)
--    was re-claimed, so overlapping deliveries both ran the handler.
-- ---------------------------------------------------------------------------
alter table public.stripe_events
  add column if not exists claimed_at timestamptz;

create or replace function public.claim_stripe_event(p_event_id text, p_type text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean;
begin
  insert into public.stripe_events (event_id, type, status, attempts, claimed_at)
  values (p_event_id, p_type, 'processing', 1, now())
  on conflict (event_id) do update
    set attempts = public.stripe_events.attempts + 1,
        status = 'processing',
        claimed_at = now()
    where public.stripe_events.status = 'failed'
       or (public.stripe_events.status = 'processing'
           and coalesce(public.stripe_events.claimed_at, public.stripe_events.created_at)
               < now() - interval '10 minutes')
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_stripe_event(text, text) from public, anon, authenticated;
grant execute on function public.claim_stripe_event(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Service-role-only functions that were revoked only "from public".
--     All are called with createAdminClient() in src/.
-- ---------------------------------------------------------------------------
revoke all on function public.finalize_ai_usage(
  uuid, text, text, text, text, int, int, numeric, int, int, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.finalize_ai_usage(
  uuid, text, text, text, text, int, int, numeric, int, int, boolean, uuid
) to service_role;

revoke all on function public.claim_due_emails(int, int) from public, anon, authenticated;
grant execute on function public.claim_due_emails(int, int) to service_role;

revoke all on function public.merge_anonymous_events(text, uuid) from public, anon, authenticated;
grant execute on function public.merge_anonymous_events(text, uuid) to service_role;

revoke all on function public.record_cron_run_start(text, text, text) from public, anon, authenticated;
revoke all on function public.record_cron_run_finish(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.cron_job_health() from public, anon, authenticated;
grant execute on function public.record_cron_run_start(text, text, text) to service_role;
grant execute on function public.record_cron_run_finish(uuid, text, integer, text, text) to service_role;
grant execute on function public.cron_job_health() to service_role;

revoke all on function public.readiness_schema_probe() from public, anon, authenticated;
grant execute on function public.readiness_schema_probe() to service_role;

-- Trigger-only functions (cannot run as RPCs, revoked for hygiene).
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.enforce_beta_capacity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Auth request-flood limits (signup / password reset / resend
--     verification). Buckets are hashed (sha256 of IP or address) by the
--     server, so no raw IP or email is stored. Service-role only.
-- ---------------------------------------------------------------------------
create table if not exists public.auth_rate_limits (
  bucket text not null,
  created_at timestamptz not null default now()
);

create index if not exists auth_rate_limits_bucket_idx
  on public.auth_rate_limits (bucket, created_at desc);

alter table public.auth_rate_limits enable row level security;
-- No policies: only claim_auth_rate_limit (service role) touches it.

-- Returns 0 and records the hit when allowed; otherwise the seconds until the
-- oldest hit in the window expires (use as Retry-After). Old hits for the
-- bucket are pruned on every call, so the table stays small.
create or replace function public.claim_auth_rate_limit(
  p_bucket text,
  p_limit int,
  p_window_seconds int
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window interval := make_interval(secs => greatest(p_window_seconds, 1));
  v_count int;
  v_oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('auth_rate:' || p_bucket, 0));

  delete from public.auth_rate_limits
   where bucket = p_bucket and created_at < now() - v_window;

  select count(*), min(created_at) into v_count, v_oldest
    from public.auth_rate_limits
   where bucket = p_bucket;

  if v_count >= greatest(p_limit, 1) then
    return greatest(1, ceil(extract(epoch from (v_oldest + v_window - now())))::int);
  end if;

  insert into public.auth_rate_limits (bucket) values (p_bucket);
  return 0;
end;
$$;

revoke all on function public.claim_auth_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.claim_auth_rate_limit(text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 12. Size ceilings on health/wellbeing free text that the browser can still
--     write directly through RLS. The real (tighter) limits live in the Zod
--     schemas the server routes enforce (src/schemas/wellbeing.ts); these are
--     generous backstops against oversized payloads, NOT VALID so no existing
--     row is rejected retroactively.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('wellbeing_profiles', 'wellbeing_profiles_wake_time_len',      'wake_time is null or char_length(wake_time) <= 32'),
      ('wellbeing_profiles', 'wellbeing_profiles_sleep_time_len',     'sleep_time is null or char_length(sleep_time) <= 32'),
      ('wellbeing_profiles', 'wellbeing_profiles_work_schedule_len',  'work_schedule is null or char_length(work_schedule) <= 500'),
      ('wellbeing_profiles', 'wellbeing_profiles_food_prefs_count',   'food_preferences is null or cardinality(food_preferences) <= 100'),
      ('wellbeing_profiles', 'wellbeing_profiles_allergies_count',    'allergies is null or cardinality(allergies) <= 100'),
      ('wellbeing_profiles', 'wellbeing_profiles_disliked_count',     'disliked_ingredients is null or cardinality(disliked_ingredients) <= 100'),
      ('daily_checkins',     'daily_checkins_hunger_pattern_len',     'hunger_pattern is null or char_length(hunger_pattern) <= 1000'),
      ('daily_checkins',     'daily_checkins_time_available_len',     'time_available is null or char_length(time_available) <= 200'),
      ('daily_checkins',     'daily_checkins_today_focus_len',        'today_focus is null or char_length(today_focus) <= 1000'),
      ('daily_checkins',     'daily_checkins_notes_len',              'notes is null or char_length(notes) <= 4000')
    ) as t(tbl, conname, expr)
  loop
    if not exists (select 1 from pg_constraint where conname = c.conname) then
      execute format(
        'alter table public.%I add constraint %I check (%s) not valid',
        c.tbl, c.conname, c.expr
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- PREFLIGHT (optional, before applying):
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public'
--      and tablename in ('subscriptions','profiles','ai_usage_events','safety_events',
--                        'daily_plans','weekly_plans','wellbeing_profiles',
--                        'plan_feedback','habit_logs')
--    order by tablename, cmd;
--   select id, user_id, route, status, estimated_cost_usd, actual_cost_usd, created_at
--     from public.ai_usage_events
--    where created_at > now() + interval '1 hour'
--       or coalesce(actual_cost_usd, estimated_cost_usd, 0) > 1;
--
-- VERIFICATION (after applying): run supabase/checks/rls-audit.sql — every
-- query returns ZERO rows.
--
-- Rollback (restores the pre-055 behaviour; not recommended — it reopens the
-- holes above):
--   create policy "subscriptions_update_own" on public.subscriptions
--     for update using (auth.uid() = user_id);   -- etc. for each dropped policy
--   drop trigger if exists wellbeing_profiles_guard_sample_adjustment on public.wellbeing_profiles;
--   drop function if exists public.guard_sample_adjustment_used_at();
--   drop function if exists public.claim_auth_rate_limit(text, int, int);
--   drop table if exists public.auth_rate_limits;
