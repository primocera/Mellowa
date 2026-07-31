-- MW-V12-04: distinguish "reminders off because you unsubscribed from an email"
-- from "reminders never turned on".
--
-- One-click unsubscribe sets reminders_opt_in = false, but so does never opting
-- in, so the settings surface could not honestly tell the user WHY reminders are
-- off — the open P2-REMINDER-OPTOUT-SURFACE gap. This records the moment a
-- one-click (or footer) unsubscribe happened, so Settings can say so and offer a
-- clear, explicit re-enable. It is cleared when the user turns reminders back on.
--
-- Additive and nullable: existing rows read NULL (never unsubscribed), and no
-- backfill is needed. Re-runnable.
alter table public.wellbeing_profiles
  add column if not exists reminders_unsubscribed_at timestamptz;

comment on column public.wellbeing_profiles.reminders_unsubscribed_at is
  'When the user last unsubscribed from reminder email via one-click/footer link. '
  'NULL = never unsubscribed. Cleared when reminders are re-enabled in Settings. '
  'Only distinguishes the opt-out reason; it does not itself gate sending — '
  'reminders_opt_in does.';
