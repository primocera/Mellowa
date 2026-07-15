-- Mellowa v4 — Prompt 13: prevent repeated trials + harden checkout.
-- Run in Supabase SQL Editor after 004_mellowa_v3_usage_completions.sql.

alter table public.subscriptions
  add column if not exists trial_used_at timestamptz,
  add column if not exists first_trial_subscription_id text;

-- Backfill: any row that already carries trial data has used its one trial.
update public.subscriptions
set trial_used_at = coalesce(trial_used_at, trial_start, created_at),
    first_trial_subscription_id = coalesce(first_trial_subscription_id, stripe_subscription_id)
where trial_start is not null
  and trial_used_at is null;
