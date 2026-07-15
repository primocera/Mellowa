-- Mellowa v4 — Prompt 4: deeper onboarding & preferences.
-- Run in Supabase SQL Editor after 008_mellowa_v4_checkin_context.sql.
-- All additive columns on the existing wellbeing_profiles table (RLS already
-- enabled in 001), so no new policies are needed.

alter table public.wellbeing_profiles
  -- Legal: users must confirm they are 18+ to use Mellowa.
  add column if not exists is_adult boolean not null default false,
  -- Locale/time context so plans and (future) reminders land on the user's day.
  add column if not exists timezone text,
  add column if not exists locale text,
  -- Day shape.
  add column if not exists schedule_type text,
  add column if not exists meal_pattern text,
  -- Dislikes are a PREFERENCE, kept separate from allergies (a safety field).
  add column if not exists disliked_ingredients text[] default '{}',
  add column if not exists kitchen_equipment text[] default '{}',
  add column if not exists default_servings int not null default 1,
  -- Reminder + quiet-hours choices (delivery itself is Prompt 12).
  add column if not exists reminders_opt_in boolean not null default false,
  add column if not exists reminder_time text,
  add column if not exists quiet_hours_start text,
  add column if not exists quiet_hours_end text,
  -- Versioned safety/privacy consent so we can prompt for re-consent later.
  add column if not exists consent_version text,
  add column if not exists consent_accepted_at timestamptz;
