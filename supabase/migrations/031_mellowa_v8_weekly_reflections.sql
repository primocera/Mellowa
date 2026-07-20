-- MW-S06 (v8): weekly reflection — explicit, bounded carry-forward selections.
--
-- Stores only the user's EXPLICIT closed-set answers (what to keep, what to
-- make lighter, next week's practical constraint). Computed summaries are
-- derived on read from the user's own rows and never stored as truth.

create table if not exists public.weekly_reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  keep text[] not null default '{}',
  lighter text check (lighter in (
    'whole_week','mornings','evenings','meals','nothing'
  )),
  next_week_constraint text check (next_week_constraint in (
    'less_time','more_time','away_or_travel','irregular_schedule','same_as_usual'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

alter table public.weekly_reflections enable row level security;

drop policy if exists "weekly reflections select own" on public.weekly_reflections;
create policy "weekly reflections select own" on public.weekly_reflections
  for select using (auth.uid() = user_id);
drop policy if exists "weekly reflections insert own" on public.weekly_reflections;
create policy "weekly reflections insert own" on public.weekly_reflections
  for insert with check (auth.uid() = user_id);
drop policy if exists "weekly reflections update own" on public.weekly_reflections;
create policy "weekly reflections update own" on public.weekly_reflections
  for update using (auth.uid() = user_id);
drop policy if exists "weekly reflections delete own" on public.weekly_reflections;
create policy "weekly reflections delete own" on public.weekly_reflections
  for delete using (auth.uid() = user_id);
