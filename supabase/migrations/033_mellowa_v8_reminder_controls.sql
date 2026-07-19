-- MW-S08 (v8): reminder pause/skip controls + explicit consent version.
--
-- Reminders stay off by default (reminders_opt_in, v4). This adds one-tap
-- pause, a skip-today marker and the consent version recorded when the user
-- enabled reminders after seeing the example content.

alter table public.wellbeing_profiles
  add column if not exists reminders_paused boolean not null default false,
  add column if not exists reminder_skip_date date,
  add column if not exists reminder_consent_version text;
