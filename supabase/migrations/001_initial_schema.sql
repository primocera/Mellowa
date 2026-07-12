-- DailyFlow AI — initial schema
-- Run in Supabase SQL Editor (or `supabase db push`).
-- All user-owned tables have RLS: users can only touch their own rows.

-- ========== helpers ==========

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ========== profiles ==========

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_delete_own" on public.profiles for delete using (auth.uid() = id);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ========== wellbeing_profiles ==========

create table if not exists public.wellbeing_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  age_range text,
  primary_goal text,
  wake_time text,
  sleep_time text,
  work_schedule text,
  food_preferences text[] default '{}',
  allergies text[] default '{}',
  cooking_time text,
  budget_level text,
  movement_level text,
  sleep_quality_baseline text,
  stress_baseline text,
  supplement_use text,
  preferred_tone text,
  safety_acknowledged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists wellbeing_profiles_user_idx on public.wellbeing_profiles (user_id);

-- ========== daily_checkins ==========

create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  checkin_date date not null default current_date,
  energy_level int check (energy_level between 1 and 5),
  mood_level int check (mood_level between 1 and 5),
  stress_level int check (stress_level between 1 and 5),
  sleep_quality int check (sleep_quality between 1 and 5),
  hunger_pattern text,
  time_available text,
  today_focus text,
  notes text,
  safety_flag boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists daily_checkins_user_date_idx on public.daily_checkins (user_id, checkin_date desc);

-- ========== daily_plans ==========

create table if not exists public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  checkin_id uuid references public.daily_checkins(id) on delete set null,
  plan_date date not null default current_date,
  plan_summary jsonb,
  morning_routine jsonb,
  meal_rhythm jsonb,
  hydration_plan jsonb,
  movement_plan jsonb,
  stress_reset jsonb,
  focus_plan jsonb,
  evening_routine jsonb,
  habit_focus jsonb,
  encouragement text,
  safety_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists daily_plans_user_date_idx on public.daily_plans (user_id, plan_date desc);

-- ========== weekly_plans ==========

create table if not exists public.weekly_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  weekly_focus text,
  meal_structure jsonb,
  shopping_list jsonb,
  movement_plan jsonb,
  stress_plan jsonb,
  habit_plan jsonb,
  low_energy_backup_plan jsonb,
  review_questions jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists weekly_plans_user_week_idx on public.weekly_plans (user_id, week_start desc);

-- ========== meal_ideas ==========

create table if not exists public.meal_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  meal_type text,
  idea jsonb,
  created_at timestamptz not null default now()
);

create index if not exists meal_ideas_user_idx on public.meal_ideas (user_id);

-- ========== shopping_lists ==========

create table if not exists public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  weekly_plan_id uuid references public.weekly_plans(id) on delete cascade,
  items jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shopping_lists_user_idx on public.shopping_lists (user_id);

-- ========== habits ==========

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  category text,
  frequency text,
  minimum_version text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists habits_user_idx on public.habits (user_id);

-- ========== habit_logs ==========

create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  log_date date not null default current_date,
  completed boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (habit_id, log_date)
);

create index if not exists habit_logs_user_date_idx on public.habit_logs (user_id, log_date desc);

-- ========== journal_entries ==========

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_date date not null default current_date,
  prompt text,
  answer text,
  mood_before int check (mood_before between 1 and 5),
  mood_after int check (mood_after between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists journal_entries_user_date_idx on public.journal_entries (user_id, entry_date desc);

-- ========== safety_events (private) ==========

create table if not exists public.safety_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text,
  risk_type text,
  risk_level text,
  user_input_excerpt text,
  action_taken text,
  created_at timestamptz not null default now()
);

create index if not exists safety_events_user_idx on public.safety_events (user_id, created_at desc);

-- ========== subscriptions (private) ==========

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan_name text,
  status text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists subscriptions_user_idx on public.subscriptions (user_id);

-- ========== RLS for all user-owned tables ==========

do $$
declare
  t text;
begin
  foreach t in array array[
    'wellbeing_profiles','daily_checkins','daily_plans','weekly_plans',
    'meal_ideas','shopping_lists','habits','habit_logs','journal_entries',
    'safety_events','subscriptions'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s_select_own" on public.%I for select using (auth.uid() = user_id)', t, t);
    execute format('create policy "%s_insert_own" on public.%I for insert with check (auth.uid() = user_id)', t, t);
    execute format('create policy "%s_update_own" on public.%I for update using (auth.uid() = user_id)', t, t);
    execute format('create policy "%s_delete_own" on public.%I for delete using (auth.uid() = user_id)', t, t);
  end loop;
end;
$$;

-- ========== updated_at triggers ==========

do $$
declare
  t text;
begin
  foreach t in array array[
    'wellbeing_profiles','daily_plans','weekly_plans','habits','subscriptions'
  ]
  loop
    execute format('create trigger %s_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end;
$$;
