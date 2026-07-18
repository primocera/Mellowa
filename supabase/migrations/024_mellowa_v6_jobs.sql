-- Launch & Scale v6, Prompt 15 — scalable scheduled jobs.
-- Batched recipient lookup: replaces admin.auth.getUserById inside cron loops
-- (an N+1 of one HTTP call per user) with one RPC per batch.

create or replace function public.get_user_emails(p_user_ids uuid[])
returns table (user_id uuid, email text)
language sql
security definer
set search_path = public, auth
as $$
  select u.id, u.email::text
  from auth.users u
  where u.id = any(p_user_ids)
    and u.deleted_at is null;
$$;

revoke all on function public.get_user_emails(uuid[]) from public;
revoke all on function public.get_user_emails(uuid[]) from anon;
revoke all on function public.get_user_emails(uuid[]) from authenticated;
grant execute on function public.get_user_emails(uuid[]) to service_role;

-- Outbox observability: queue depth and oldest due job in one call.
create or replace function public.email_outbox_stats()
returns table (queued bigint, oldest_due timestamptz, dead_lettered bigint)
language sql
security definer
set search_path = public
as $$
  select
    count(*) filter (where status in ('pending', 'failed_transient', 'not_configured')),
    min(next_attempt_at) filter (where status in ('pending', 'failed_transient', 'not_configured')),
    count(*) filter (where status = 'failed_permanent')
  from public.email_deliveries;
$$;

revoke all on function public.email_outbox_stats() from public;
revoke all on function public.email_outbox_stats() from anon;
revoke all on function public.email_outbox_stats() from authenticated;
grant execute on function public.email_outbox_stats() to service_role;

-- Keyset pagination support for the daily reminder scan.
create index if not exists wellbeing_profiles_reminders_idx
  on public.wellbeing_profiles (user_id)
  where reminders_opt_in = true and reminder_time is not null;
