-- Mellowa v6 — Launch Prompt 4: email outbox with replayable payloads.
-- Run in Supabase SQL Editor after 020_mellowa_v6_idempotency.sql.
--
-- The v5 email_deliveries ledger records outcomes but cannot replay a
-- failure: the rendered email lived only in the originating request. This
-- migration stores the payload and adds an atomic claim so a scheduled
-- worker (Vercel cron or an external pinger hitting /api/cron/email-outbox)
-- can retry transient failures with backoff, independent of the original
-- webhook/browser request.

alter table public.email_deliveries
  add column if not exists to_email text,
  add column if not exists subject text,
  add column if not exists html text,
  add column if not exists next_attempt_at timestamptz;

-- Cheap due-work scan: only retryable rows, ordered by due time.
create index if not exists email_deliveries_due_idx
  on public.email_deliveries (next_attempt_at)
  where status in ('pending', 'not_configured', 'failed_transient');

-- Atomically claim due retryable rows. SKIP LOCKED means overlapping worker
-- runs never double-send; the lease (next_attempt_at bump) means a crashed
-- worker's rows come due again on a later run.
create or replace function public.claim_due_emails(
  p_limit int default 20,
  p_lease_minutes int default 10
) returns setof public.email_deliveries
language sql
security definer
set search_path = public
as $$
  update public.email_deliveries e
    set next_attempt_at = now() + make_interval(mins => p_lease_minutes),
        updated_at = now()
  where e.id in (
    select id from public.email_deliveries
    where status in ('pending', 'not_configured', 'failed_transient')
      and (next_attempt_at is null or next_attempt_at <= now())
    order by next_attempt_at asc nulls first
    limit p_limit
    for update skip locked
  )
  returning e.*;
$$;

revoke all on function public.claim_due_emails(int, int) from public;
grant execute on function public.claim_due_emails(int, int) to service_role;
