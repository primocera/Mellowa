-- Mellowa v6 — Launch Prompt 9: product analytics contract.
-- Run in Supabase SQL Editor after 021_mellowa_v6_email_outbox.sql.
--
-- Upgrades the minimal app_events ledger (migration 013) into a versioned,
-- enumerated contract: a schema version, a closed set of enumerated properties
-- (validated in application code — never free text), and an anonymous
-- attribution id that merges onto the user on verified signup.

alter table public.app_events
  add column if not exists event_version integer not null default 1,
  add column if not exists anon_id text,
  add column if not exists properties jsonb not null default '{}'::jsonb;

-- Attribution scan: pre-signup events are keyed by anon_id until merged.
create index if not exists app_events_anon_idx
  on public.app_events (anon_id)
  where anon_id is not null;

-- Merge anonymous pre-signup events onto a verified user. Called once from the
-- trusted post-verification path. Clears anon_id so a merged row is never
-- re-attributed. Service-role only.
create or replace function public.merge_anonymous_events(
  p_anon_id text,
  p_user_id uuid
) returns integer
language sql
security definer
set search_path = public
as $$
  with moved as (
    update public.app_events
      set user_id = p_user_id,
          anon_id = null
    where anon_id = p_anon_id
      and user_id is null
    returning 1
  )
  select count(*)::int from moved;
$$;

revoke all on function public.merge_anonymous_events(text, uuid) from public;
grant execute on function public.merge_anonymous_events(text, uuid) to service_role;
