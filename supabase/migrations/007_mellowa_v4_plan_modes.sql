-- Mellowa v4 — Prompt 2: mode-aware daily plans.
-- Run in Supabase SQL Editor after 006_mellowa_v4_stripe_events.sql.

alter table public.daily_plans
  add column if not exists plan_mode text;

-- Older plans keep null plan_mode; the renderer falls back to plan_intensity.
