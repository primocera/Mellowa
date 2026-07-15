-- Mellowa v4 — Prompt 6: save/favourite meals + shopping-list building.
-- Run in Supabase SQL Editor after 010_mellowa_v4_ai_cost.sql.

-- One row per meal a user has saved. The full meal card is kept as jsonb so it
-- can be re-shown and reused without regenerating. meal_signature dedupes the
-- same meal being saved twice.
create table if not exists public.favourite_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  meal_signature text not null,   -- lowercased title + meal_type
  meal_type text not null,
  title text not null,
  meal jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, meal_signature)
);

create index if not exists favourite_meals_user_idx
  on public.favourite_meals (user_id, created_at desc);

alter table public.favourite_meals enable row level security;

drop policy if exists "favourite_meals_select_own" on public.favourite_meals;
drop policy if exists "favourite_meals_insert_own" on public.favourite_meals;
drop policy if exists "favourite_meals_delete_own" on public.favourite_meals;
create policy "favourite_meals_select_own" on public.favourite_meals
  for select using (auth.uid() = user_id);
create policy "favourite_meals_insert_own" on public.favourite_meals
  for insert with check (auth.uid() = user_id);
create policy "favourite_meals_delete_own" on public.favourite_meals
  for delete using (auth.uid() = user_id);
