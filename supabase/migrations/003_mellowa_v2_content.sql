-- Mellowa v2 — content 2.0: meal cards, richer daily plan, profile prefs.
-- Run in Supabase SQL Editor after 002_mellowa_v2_trial.sql.

-- ========== daily_plans: v2 sections ==========
alter table public.daily_plans
  add column if not exists plan_intensity text,
  add column if not exists meal_cards jsonb,
  add column if not exists breathing_exercise jsonb,
  add column if not exists meditation_or_reflection jsonb,
  add column if not exists relaxation_technique jsonb,
  add column if not exists hydration_plan_v2 jsonb;
-- Reused existing jsonb columns: plan_summary, movement_plan (movement_moment),
-- focus_plan (focus_block), evening_routine (evening_wind_down),
-- habit_focus (one_small_habit).

-- ========== wellbeing_profiles: plan preferences ==========
alter table public.wellbeing_profiles
  add column if not exists show_macros boolean not null default true,
  add column if not exists macro_focus text,
  add column if not exists preferred_meal_prep_time text,
  add column if not exists cooking_skill text,
  add column if not exists movement_preference text[] default '{}',
  add column if not exists movement_limitations text,
  add column if not exists stress_reset_preference text[] default '{}',
  add column if not exists meditation_experience text,
  add column if not exists preferred_routine_length text;

-- ========== generated_meal_cards ==========
create table if not exists public.generated_meal_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  daily_plan_id uuid references public.daily_plans(id) on delete cascade,
  meal_type text not null,
  title text not null,
  short_description text,
  prep_time_minutes integer,
  cook_time_minutes integer,
  total_time_minutes integer,
  difficulty text,
  budget_level text,
  servings integer default 1,
  ingredients jsonb not null default '[]'::jsonb,
  preparation_steps jsonb not null default '[]'::jsonb,
  approximate_macros jsonb not null default '{}'::jsonb,
  swaps jsonb not null default '{}'::jsonb,
  grocery_items jsonb not null default '[]'::jsonb,
  safety_note text,
  created_at timestamptz not null default now()
);

create index if not exists generated_meal_cards_user_idx
  on public.generated_meal_cards (user_id, created_at desc);
create index if not exists generated_meal_cards_plan_idx
  on public.generated_meal_cards (daily_plan_id);

alter table public.generated_meal_cards enable row level security;

create policy "generated_meal_cards_select_own" on public.generated_meal_cards
  for select using (auth.uid() = user_id);
create policy "generated_meal_cards_insert_own" on public.generated_meal_cards
  for insert with check (auth.uid() = user_id);
create policy "generated_meal_cards_update_own" on public.generated_meal_cards
  for update using (auth.uid() = user_id);
create policy "generated_meal_cards_delete_own" on public.generated_meal_cards
  for delete using (auth.uid() = user_id);
