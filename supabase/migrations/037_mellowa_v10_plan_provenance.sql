-- MW-V10-04 (v10): per-plan provenance.
--
-- The AI usage ledger already records prompt_version, model and whether a
-- fallback was served — but it is keyed by usage event, not by plan, so there
-- was no way to say "this plan in front of you was made with X". That mattered
-- in two places:
--
--   1. The user could not tell a curated fallback plan from a generated one.
--      A fallback is honest and bounded, but only if it is labelled.
--   2. An eval or a support request could not reproduce a specific plan,
--      because the exact prompt version that produced it was not recorded
--      alongside it.
--
-- Additive and nullable: existing plans read as "provenance not recorded",
-- which the UI states plainly rather than guessing a version.
--
-- These columns hold version identifiers only. No prompt text is ever stored
-- here — the system prompt stays in the code, versioned by
-- src/prompts/versions.ts, and is never exposed to the client.

alter table public.daily_plans
  add column if not exists prompt_version text,
  add column if not exists model_version text,
  add column if not exists is_fallback boolean not null default false;

-- Version ids are slugs (e.g. "daily-plan-v2@1", "claude-haiku-4-5-20251001").
-- The check keeps prose and prompt text out of a column the UI renders.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'daily_plans_prompt_version_slug'
  ) then
    alter table public.daily_plans
      add constraint daily_plans_prompt_version_slug
      check (prompt_version is null or prompt_version ~ '^[A-Za-z0-9][A-Za-z0-9._@:-]{0,63}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'daily_plans_model_version_slug'
  ) then
    alter table public.daily_plans
      add constraint daily_plans_model_version_slug
      check (model_version is null or model_version ~ '^[A-Za-z0-9][A-Za-z0-9._@:-]{0,63}$');
  end if;
end $$;

-- Fallback rate per prompt version is the signal that a prompt or model change
-- degraded generation; this index makes that query cheap.
create index if not exists daily_plans_provenance_idx
  on public.daily_plans (prompt_version, is_fallback)
  where prompt_version is not null;

comment on column public.daily_plans.prompt_version is
  'MW-V10-04: immutable prompt version id from src/prompts/versions.ts. Never prompt text.';
comment on column public.daily_plans.is_fallback is
  'MW-V10-04: true when this plan is the curated fallback, not a generated one. Surfaced to the user.';
