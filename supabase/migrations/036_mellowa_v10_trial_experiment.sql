-- MW-V10-02 (v10): server-owned trial-length experiment assignment.
--
-- Premium promises "adapt today", "reuse what works" and "carry it into next
-- week", but a 3-day trial can end before a user ever reaches a week closeout.
-- Testing a 7-day cohort requires that the assigned length is decided by the
-- server, pinned once, and never re-derived — an active user's charge date must
-- not move because a flag was flipped or a rollout percentage changed.
--
-- Additive only. Existing rows stay NULL, which the app reads as "no
-- experiment assignment" and resolves to the 3-day control, so this migration
-- changes no behaviour on its own.
--
-- Columns hold a variant CODE and a day count only. No cohort assignment
-- carries wellbeing content, check-in values or any other user data.

alter table public.subscriptions
  add column if not exists trial_variant text,
  add column if not exists trial_days smallint,
  add column if not exists trial_variant_assigned_at timestamptz;

-- The allowlist lives in the app (src/lib/stripe/trial-experiment.ts); the
-- database enforces the shape so a bad write cannot store prose or an absurd
-- trial length that would then be disclosed to a user as a charge date.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_trial_variant_code'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_trial_variant_code
      check (trial_variant is null or trial_variant ~ '^[a-z][a-z0-9_]{0,31}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_trial_days_range'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_trial_days_range
      check (trial_days is null or (trial_days >= 1 and trial_days <= 31));
  end if;
end $$;

-- Owner-facing cohort comparison groups by variant over the whole table.
create index if not exists subscriptions_trial_variant_idx
  on public.subscriptions (trial_variant)
  where trial_variant is not null;

comment on column public.subscriptions.trial_variant is
  'MW-V10-02: pinned trial-length experiment variant code (allowlisted in app). NULL = unassigned, resolves to control.';
comment on column public.subscriptions.trial_days is
  'MW-V10-02: trial length in days pinned at checkout. Once set it is authoritative for every disclosure — never recomputed from the flag.';
