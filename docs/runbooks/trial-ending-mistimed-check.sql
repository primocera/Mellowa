-- MW-V11 — "trial-ending email arrived after the trial already ended"
--
-- Run in the Supabase SQL Editor against production. This confirms which of the
-- two defects fired for a given user before/after the fix, using the LEDGER as
-- the source of truth — not an inbox. Replace <your-user-id> throughout.
--
-- Background: the trial-reminders cron runs once a day at 09:00 UTC. Before the
-- fix it looked only 24h ahead and hard-coded the subject "ends tomorrow", so a
-- trial ending later in the day than 09:00 UTC was caught the same day it ended
-- (a few hours' notice), and any provider/inbox lag pushed the mail past the
-- real trial_end while it still said "tomorrow".

-- ---------------------------------------------------------------------------
-- 1 · The subscription row: is the trial actually over, and did the row lag?
-- ---------------------------------------------------------------------------
-- Want to see: trial_end (UTC), whether it is now in the past, the current
-- status, and whether the reminder was marked sent. If status is still
-- 'trialing' with a past trial_end, the conversion webhook has not applied yet
-- (a separate issue); if status is 'active'/'past_due', the trial converted and
-- the reminder was simply mistimed.
select
  user_id,
  status,
  trial_start,
  trial_end,
  (trial_end < now())            as trial_already_ended,
  trial_reminder_sent,
  plan_name,
  current_period_end,
  last_stripe_event_created
from public.subscriptions
where user_id = '<your-user-id>';

-- ---------------------------------------------------------------------------
-- 2 · The delivery: did the email go out AFTER the trial ended?
-- ---------------------------------------------------------------------------
-- Join the ledger send time against trial_end. If sent_at > trial_end (or even
-- close to it), the reminder had no useful lead time — defect #2. The event_key
-- carries the trial_end it was sent for, so a stale send is visible here.
select
  d.template,
  d.status,
  d.event_key,
  d.sent_at,
  s.trial_end,
  (d.sent_at > s.trial_end)                            as sent_after_trial_ended,
  round(extract(epoch from (s.trial_end - d.sent_at)) / 3600.0, 1) as lead_time_hours
from public.email_deliveries d
join public.subscriptions s on s.user_id = d.user_id
where d.user_id = '<your-user-id>'
  and d.template = 'trial_ending'
order by d.created_at desc;

-- ---------------------------------------------------------------------------
-- 3 · The timezone the fix now formats in.
-- ---------------------------------------------------------------------------
-- The new cron computes "today / tomorrow / in N days" and the charge date in
-- this zone. If it is null/invalid the mail falls back to UTC (old behaviour).
select user_id, timezone
from public.wellbeing_profiles
where user_id = '<your-user-id>';
