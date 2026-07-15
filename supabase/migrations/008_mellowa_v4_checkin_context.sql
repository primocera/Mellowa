-- Mellowa v4 — Prompt 3: faster contextual check-in.
-- Run in Supabase SQL Editor after 007_mellowa_v4_plan_modes.sql.

alter table public.daily_checkins
  add column if not exists context text,
  add column if not exists client_timezone text;
