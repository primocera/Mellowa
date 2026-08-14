-- MW-V18-06: provenance for onboarding-completion backfill.
--
-- onboarding_completions (migration 043) records the exactly-once activation
-- milestone for users who complete onboarding AFTER that table existed. Legacy
-- users who finished onboarding earlier have no row, so they are missing from
-- activation cohorts. This adds provenance columns so a backfilled row is
-- clearly distinguishable from a runtime one and never claims a fabricated
-- original completion time.
--
--   source             'runtime' (the live route) | 'legacy_backfill'
--   inferred_at        when a backfill inferred this row (NULL for runtime)
--   definition_version the completion-evidence definition used to infer it
--
-- completed_at for a backfilled row is set to the strongest DURABLE timestamp
-- we actually have (the profile's updated_at), NOT invented — and inferred_at +
-- source make explicit that it is inferred, not observed.
--
-- Additive and idempotent. Existing rows default to source='runtime', matching
-- how they were created. Rollback needs no reversal (columns are nullable/keyed
-- with safe defaults and the backfill job is re-runnable via ON CONFLICT).

alter table public.onboarding_completions
  add column if not exists source text not null default 'runtime',
  add column if not exists inferred_at timestamptz,
  add column if not exists definition_version text;

-- Guard the vocabulary so a stray writer cannot invent a third provenance.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'onboarding_completions_source_chk'
  ) then
    alter table public.onboarding_completions
      add constraint onboarding_completions_source_chk
      check (source in ('runtime', 'legacy_backfill'));
  end if;
end $$;

comment on column public.onboarding_completions.source is
  'MW-V18-06: runtime (live onboarding route) or legacy_backfill (inferred from '
  'durable wellbeing_profiles evidence).';
comment on column public.onboarding_completions.inferred_at is
  'When a backfill inferred this completion. NULL for runtime rows. The '
  'completed_at of a backfilled row is the profile updated_at (strongest durable '
  'timestamp), not a fabricated original completion time.';
