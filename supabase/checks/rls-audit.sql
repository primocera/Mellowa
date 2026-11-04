-- RLS + RPC runtime audit (Launch v6, Prompt 16).
-- Paste into the Supabase SQL editor of the LIVE Mellowa project.
-- Every query should return ZERO rows; any row is a finding.

-- 1. Tables in public without RLS enabled
select tablename as table_without_rls
from pg_catalog.pg_tables t
where schemaname = 'public'
  and not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = t.tablename and c.relrowsecurity
  );

-- 2. SECURITY DEFINER functions without a pinned search_path
select p.proname as definer_without_search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%';

-- 3. Functions executable by anon (there should be none of ours)
select p.proname as anon_executable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'execute')
  and p.proname in (
    'claim_ai_generation','finalize_ai_usage','claim_generation_request',
    'finish_generation_request','claim_due_emails','merge_anonymous_events',
    'get_user_emails','email_outbox_stats',
    -- 055
    'claim_daily_plan_generation','finish_daily_plan_generation',
    'claim_stripe_event','record_cron_run_start','record_cron_run_finish',
    'cron_job_health','readiness_schema_probe','claim_auth_rate_limit'
  );

-- 4. Service-role-only functions that authenticated can still execute
select p.proname as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('authenticated', p.oid, 'execute')
  and p.proname in (
    'claim_ai_generation','finalize_ai_usage','claim_due_emails',
    'merge_anonymous_events','get_user_emails','email_outbox_stats',
    -- 055
    'claim_stripe_event','record_cron_run_start','record_cron_run_finish',
    'cron_job_health','readiness_schema_probe','claim_auth_rate_limit'
  );

-- 4a. (055) User write policies on billing / metering / safety state. Users may
--     only READ these rows; every write goes through the service role.
select tablename || '.' || policyname || ' (' || cmd || ')' as user_write_policy_on_server_table
from pg_policies
where schemaname = 'public'
  and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  and (
    tablename in ('subscriptions', 'ai_usage_events', 'safety_events')
    or (tablename = 'profiles' and cmd in ('INSERT', 'DELETE', 'ALL'))
    or (tablename = 'daily_plans' and cmd in ('DELETE', 'ALL'))
    or (tablename = 'weekly_plans' and cmd in ('UPDATE', 'DELETE', 'ALL'))
    or (tablename = 'wellbeing_profiles' and cmd in ('DELETE', 'ALL'))
  );

-- 4b. (055) The free-sample adjustment marker must stay server-managed.
select 'wellbeing_profiles_guard_sample_adjustment missing' as sample_guard_missing
where not exists (
  select 1 from pg_trigger
  where tgname = 'wellbeing_profiles_guard_sample_adjustment' and not tgisinternal
);

-- 4c. (055) plan_feedback / habit_logs writes must check the parent's owner.
select tablename || '.' || policyname as policy_without_parent_ownership
from pg_policies
where schemaname = 'public'
  and cmd in ('INSERT', 'UPDATE')
  and (
    (tablename = 'plan_feedback'
      and coalesce(with_check, qual, '') not like '%daily_plans%')
    or (tablename = 'habit_logs'
      and coalesce(with_check, qual, '') not like '%habits%')
  );

-- 5. Statement timeouts per role (informational — expect 5s / 3s / 30s)
select rolname, rolconfig
from pg_roles
where rolname in ('authenticated', 'anon', 'service_role');

-- 6. EXPLAIN examples for the hot paths (run individually; expect index scans)
-- explain analyze select * from daily_plans where user_id = '<uuid>' order by plan_date desc limit 1;
-- explain analyze select * from daily_checkins where user_id = '<uuid>' order by checkin_date desc limit 7;
-- explain analyze select id, user_id, trial_end from subscriptions
--   where status = 'trialing' and trial_reminder_sent = false and trial_end <= now() + interval '24 hours';
-- explain analyze select event, created_at from app_events where user_id = '<uuid>' and created_at >= now() - interval '30 days';
