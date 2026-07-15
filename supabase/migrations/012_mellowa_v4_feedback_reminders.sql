-- Mellowa v4 — Prompt 10 (feedback learning) + Prompt 12 (reminders).
-- Run in Supabase SQL Editor after 011_mellowa_v4_favourites.sql.

-- ========== plan_feedback (P10) ==========
-- "Helpful" / "Not for me" verdicts on plan items. Fed back into future
-- generations as gentle preference hints. One verdict per (plan, item).
create table if not exists public.plan_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  daily_plan_id uuid not null references public.daily_plans(id) on delete cascade,
  item_key text not null,      -- e.g. "plan", "meal:breakfast", "movement"
  verdict text not null check (verdict in ('helpful', 'not_for_me')),
  note text,                   -- optional short free text
  created_at timestamptz not null default now(),
  unique (daily_plan_id, item_key)
);

create index if not exists plan_feedback_user_idx
  on public.plan_feedback (user_id, created_at desc);

alter table public.plan_feedback enable row level security;

drop policy if exists "plan_feedback_select_own" on public.plan_feedback;
drop policy if exists "plan_feedback_insert_own" on public.plan_feedback;
drop policy if exists "plan_feedback_update_own" on public.plan_feedback;
drop policy if exists "plan_feedback_delete_own" on public.plan_feedback;
create policy "plan_feedback_select_own" on public.plan_feedback
  for select using (auth.uid() = user_id);
create policy "plan_feedback_insert_own" on public.plan_feedback
  for insert with check (auth.uid() = user_id);
create policy "plan_feedback_update_own" on public.plan_feedback
  for update using (auth.uid() = user_id);
create policy "plan_feedback_delete_own" on public.plan_feedback
  for delete using (auth.uid() = user_id);

-- ========== reminder bookkeeping (P12) ==========
-- So the daily-reminder cron sends at most one email per local day.
alter table public.wellbeing_profiles
  add column if not exists last_reminder_sent_date date;
