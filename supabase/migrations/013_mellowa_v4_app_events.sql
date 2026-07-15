-- Mellowa v4 — Prompt 20: privacy-safe product analytics.
-- Run in Supabase SQL Editor after 012_mellowa_v4_feedback_reminders.sql.

-- Minimal event ledger for beta go/no-go metrics. NO free text, NO PII beyond
-- the user id (needed for uniques); event names come from a fixed code list.
create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  event text not null,
  created_at timestamptz not null default now()
);

create index if not exists app_events_event_time_idx
  on public.app_events (event, created_at desc);

alter table public.app_events enable row level security;
-- No user-facing policies: server-only writes/reads via service role.
