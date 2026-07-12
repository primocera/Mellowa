-- Mellowa v2 — trial fields on subscriptions.
-- Run in Supabase SQL Editor after 001_initial_schema.sql.

alter table public.subscriptions
  add column if not exists trial_start timestamptz,
  add column if not exists trial_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false;
