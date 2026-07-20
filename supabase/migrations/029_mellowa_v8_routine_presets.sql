-- MW-S04 (v8): user-owned routine presets.
--
-- A preset prefills PRACTICAL check-in context only (context, time band,
-- desired mode/areas, optional weekday default). Energy/stress and today-only
-- notes are never part of a preset, and the user-chosen name never reaches AI
-- prompts or analytics. Bounded values are enforced here as well as in Zod.

create table if not exists public.routine_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  context text check (context in (
    'busy','low_capacity','out_of_routine','home','on_the_go','social'
  )),
  time_available text check (time_available in (
    'Almost none','About 10 minutes','About 20 minutes','About 30 minutes','Flexible today'
  )),
  mode text not null default 'auto' check (mode in (
    'auto','minimum','reset','balanced','custom'
  )),
  areas text[] not null default '{}',
  -- 0 = Monday … 6 = Sunday; null = no weekday default.
  weekday_default smallint check (weekday_default between 0 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists routine_presets_user_idx
  on public.routine_presets (user_id, created_at);

alter table public.routine_presets enable row level security;

drop policy if exists "presets select own" on public.routine_presets;
create policy "presets select own" on public.routine_presets
  for select using (auth.uid() = user_id);
drop policy if exists "presets insert own" on public.routine_presets;
create policy "presets insert own" on public.routine_presets
  for insert with check (auth.uid() = user_id);
drop policy if exists "presets update own" on public.routine_presets;
create policy "presets update own" on public.routine_presets
  for update using (auth.uid() = user_id);
drop policy if exists "presets delete own" on public.routine_presets;
create policy "presets delete own" on public.routine_presets
  for delete using (auth.uid() = user_id);
