-- P1-REMINDER-REHEARSAL — Supabase verification queries
--
-- Run these in the Supabase SQL Editor, against the production project, while
-- working through the worksheet at the end of docs/ops-cron.md.
--
-- Read every result from the LEDGER, not from your inbox. An email that was
-- correctly not sent is not a delivery failure, and the two are only
-- distinguishable here. An inbox cannot tell you why something did not arrive.
--
-- Replace <your-user-id> throughout. Anonymise before pasting anything into
-- release evidence: no addresses, no message bodies, last 4 chars of ids.

-- ---------------------------------------------------------------------------
-- 0 · Baseline. Did the sender fix actually take?
-- ---------------------------------------------------------------------------
-- Before 616d7e9 this returned 15 rows, all failed_permanent, all "provider
-- 422": production ran EMAIL_FROM=<hello@mellowa.app> with bare angle brackets,
-- which is not a valid address, so every send Mellowa ever attempted failed.
-- Any NEW row with status 'sent' is the first email this product has delivered.
select
  status,
  count(*)          as rows,
  max(created_at)   as latest,
  max(last_error)   as sample_error
from public.email_deliveries
group by status
order by count(*) desc;

-- ---------------------------------------------------------------------------
-- 1 · Sign up + confirm. The welcome mail.
-- ---------------------------------------------------------------------------
-- Want: status = 'sent' with a non-null provider_id.
--   not_configured  → the env vars never reached the running deployment
--   failed_*        → read last_error; it now carries the provider's reason
select template, status, attempts, provider_id, sent_at, last_error
from public.email_deliveries
where template = 'welcome'
order by created_at desc
limit 3;

-- ---------------------------------------------------------------------------
-- 2 · Click the unsubscribe link in a reminder email.
-- ---------------------------------------------------------------------------
-- Want: reminders_opt_in = false, reminders_paused = true, reminder_time = null.
--
-- This is the step that was broken until dc46c70: the route wrote to
-- `profiles` keyed by `id`, a table that does not have any of these columns.
-- The write was rejected, the user saw an error page, and all three values
-- below stayed exactly as they were.
select
  user_id,
  reminders_opt_in,
  reminders_paused,
  reminder_time,
  reminder_consent_version
from public.wellbeing_profiles
where user_id = '<your-user-id>';

-- ---------------------------------------------------------------------------
-- 3 · Prove suppression BLOCKS, not just that it RECORDS.
-- ---------------------------------------------------------------------------
-- This is the cron's own filter (src/app/api/cron/daily-reminders/route.ts).
-- Want: your user absent from the result.
--
-- Step 2 only proves a row changed. This proves the scheduler agrees.
select count(*) as would_be_mailed
from public.wellbeing_profiles
where reminders_opt_in = true
  and reminder_time is not null
  and reminders_paused = false;

-- Same filter, but naming yourself, so "absent" is unambiguous:
select user_id, reminders_opt_in, reminders_paused, reminder_time
from public.wellbeing_profiles
where reminders_opt_in = true
  and reminder_time is not null
  and reminders_paused = false
  and user_id = '<your-user-id>';

-- ---------------------------------------------------------------------------
-- 4 · Transactional mail must STILL arrive after unsubscribing.
-- ---------------------------------------------------------------------------
-- Suppressing everything is a failure in the other direction: withholding a
-- receipt or a cancellation notice from someone entitled to it. Deleting the
-- account fires account_deleted, so this evidence comes free with step 3.
--
-- Want: status = 'sent', with created_at AFTER the unsubscribe in step 2.
select template, status, sent_at, created_at
from public.email_deliveries
where template in ('account_deleted', 'canceled', 'trial_ending', 'trial_started')
  and created_at > now() - interval '1 hour'
order by created_at desc;

-- ---------------------------------------------------------------------------
-- 5 · Duplicate cron runs must not double-send.
-- ---------------------------------------------------------------------------
-- Trigger the reminder cron twice in the same window, then check that the
-- event_key deduped it. Want: zero rows.
select event_key, count(*)
from public.email_deliveries
group by event_key
having count(*) > 1;

-- ---------------------------------------------------------------------------
-- 6 · Timezone. The reminder must fire at the USER's stored zone.
-- ---------------------------------------------------------------------------
-- `npm run seed:test-user -- --state bad-timezone` is the fixture for the
-- invalid-zone repair prompt. For the normal case, confirm the send lands at
-- reminder_time in `timezone`, not in the server's UTC.
select
  user_id,
  timezone,
  reminder_time,
  quiet_hours_start,
  quiet_hours_end,
  last_reminder_sent_date
from public.wellbeing_profiles
where user_id = '<your-user-id>';

-- ---------------------------------------------------------------------------
-- 7 · Anything stuck in the outbox.
-- ---------------------------------------------------------------------------
-- failed_transient rows are retried by /api/cron/email-outbox with backoff.
-- failed_permanent rows are terminal and will NEVER be retried — deliverEmail
-- returns early on them. If a template you expected is sitting here, the
-- outbox worker is not going to fix it for you.
select template, status, attempts, next_attempt_at, last_error
from public.email_deliveries
where status in ('pending', 'not_configured', 'failed_transient', 'failed_permanent')
order by updated_at desc
limit 20;
