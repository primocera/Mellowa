-- Mellowa v4 — Prompt 14: idempotent, replay-safe Stripe webhook processing.
-- Run in Supabase SQL Editor after 005_mellowa_v4_trial_guard.sql.

create table if not exists public.stripe_events (
  event_id text primary key,          -- Stripe evt_... id (dedupe key)
  type text not null,
  status text not null default 'processing', -- processing | done | failed
  attempts int not null default 0,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists stripe_events_status_idx
  on public.stripe_events (status, created_at desc);

-- Admin/service-role only. No end user should read billing event logs, so RLS
-- is enabled with no policies (service role bypasses RLS).
alter table public.stripe_events enable row level security;

-- Atomically claim an event for processing. Returns true if the caller may
-- process it (first sight or a prior failed/stuck attempt); false if it is
-- already done or currently being processed. Safe under concurrent replays.
create or replace function public.claim_stripe_event(p_event_id text, p_type text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean;
begin
  insert into public.stripe_events (event_id, type, status, attempts)
  values (p_event_id, p_type, 'processing', 1)
  on conflict (event_id) do update
    set attempts = public.stripe_events.attempts + 1,
        status = 'processing'
    where public.stripe_events.status <> 'done'
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;
