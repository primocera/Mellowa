-- Mellowa v3 — Faza 3: AI usage metering (rate limiting) + plan completions.
-- Run in Supabase SQL Editor after 003_mellowa_v2_content.sql.

-- ========== ai_usage_events ==========
-- One row per AI generation call. Used to rate-limit per user and to protect
-- the AI provider key from abuse. Server-only writes (service role / RLS own-row).
create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  route text not null,          -- daily-plan, weekly-plan, meal-rhythm, habit-plan, journal-reflection, regenerate-section
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_user_time_idx
  on public.ai_usage_events (user_id, created_at desc);

alter table public.ai_usage_events enable row level security;

drop policy if exists "ai_usage_events_select_own" on public.ai_usage_events;
drop policy if exists "ai_usage_events_insert_own" on public.ai_usage_events;
create policy "ai_usage_events_select_own" on public.ai_usage_events
  for select using (auth.uid() = user_id);
create policy "ai_usage_events_insert_own" on public.ai_usage_events
  for insert with check (auth.uid() = user_id);

-- ========== subscriptions: trial reminder flag ==========
-- So the daily cron only sends the "trial ends tomorrow" email once.
alter table public.subscriptions
  add column if not exists trial_reminder_sent boolean not null default false;

-- ========== plan_completions ==========
-- Persists "mark as done" toggles from Today 2.0 (meals, movement, calm reset,
-- habit, etc.). One row per (user, plan, item_key) that is currently done.
create table if not exists public.plan_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  daily_plan_id uuid not null references public.daily_plans(id) on delete cascade,
  item_key text not null,       -- e.g. "meal:breakfast", "movement", "breathing", "habit"
  completed_at timestamptz not null default now(),
  unique (daily_plan_id, item_key)
);

create index if not exists plan_completions_plan_idx
  on public.plan_completions (daily_plan_id);
create index if not exists plan_completions_user_idx
  on public.plan_completions (user_id, completed_at desc);

alter table public.plan_completions enable row level security;

drop policy if exists "plan_completions_select_own" on public.plan_completions;
drop policy if exists "plan_completions_insert_own" on public.plan_completions;
drop policy if exists "plan_completions_delete_own" on public.plan_completions;
create policy "plan_completions_select_own" on public.plan_completions
  for select using (auth.uid() = user_id);
create policy "plan_completions_insert_own" on public.plan_completions
  for insert with check (auth.uid() = user_id);
create policy "plan_completions_delete_own" on public.plan_completions
  for delete using (auth.uid() = user_id);
