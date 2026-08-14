-- Mellowa v18 — MW-V18-04: durable, resumable, idempotent account-deletion state machine.
--
-- Replaces the request-bound inline deletion (src/app/api/account/delete/route.ts,
-- hardened at MW-V17-04) with a durable job record. The API creates one job and
-- kicks off processing; a server worker (Vercel cron -> /api/cron/account-deletion,
-- or one best-effort inline pass) drives the destructive steps under a lease with
-- retry/backoff, so loss of the auth identity or an email/outbox failure can never
-- make completion impossible.
--
-- Run in the Supabase SQL editor AFTER 043_mellowa_v17_onboarding_completed_unique.sql.
-- Additive only; no existing migration is edited. Rollback notes at the bottom.
--
-- STATE MACHINE (status = furthest COMPLETED milestone; on failure the row stays
-- at its last good milestone, records last_error_code + next_attempt_at, and is
-- re-claimed — there is no permanent-failed terminal, so every failed job is
-- resumable):
--
--   requested
--     -> billing_verified        (Stripe ownership proven or no billing)
--     -> subscription_cancelled  (owned live sub cancelled; idempotent)
--     -> auth_deleted            (auth identity removed + verified gone)
--     -> data_verified           (all registry residuals counted == 0)
--     -> notification_queued      (confirmation handed to the email outbox)
--     -> completed               (row minimised: user id nulled, only hash kept)
--
-- ORDERING / THREAT TRADE-OFFS (see docs/runbooks/account-deletion.md):
--   * Billing is verified & cancelled BEFORE the auth identity is deleted, so a
--     deleted account can never orphan a still-billable subscription the user can
--     no longer reach to cancel.
--   * The target user id is stored WITHOUT an auth FK on purpose — see below — so
--     deleting auth.users does NOT null it out; the worker keeps the id it needs
--     to verify residual deletion after the identity is gone. This is the core
--     invariant: destructive work, once begun, always has what it needs to finish.
--   * The confirmation email is queued THROUGH the durable outbox after data is
--     verified; a provider failure marks the outbox row retryable and never
--     reverses or traps the deletion.

create table if not exists public.account_deletion_requests (
  -- Opaque request id (returned to the client; used in the signed receipt).
  id uuid primary key default gen_random_uuid(),

  -- Target user. DELIBERATELY no FK to auth.users: the job must outlive the
  -- identity it deletes. Nulled at the `completed` step (minimisation); the hash
  -- below keeps audit correlation without retaining the raw id.
  user_id uuid,
  -- Deterministic sha256(user_id) hex, kept for support/audit after minimisation.
  user_id_hash text not null,

  -- One active request per user: `delete:<user_id>`. A duplicate POST returns the
  -- existing row instead of starting a second deletion.
  idempotency_key text not null unique,

  status text not null default 'requested'
    check (status in (
      'requested', 'billing_verified', 'subscription_cancelled',
      'auth_deleted', 'data_verified', 'notification_queued', 'completed'
    )),

  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- Machine-readable slug only (e.g. 'billing_unavailable', 'auth_delete_failed',
  -- 'residual_query_error'). Never a raw provider message, email or user text.
  last_error_code text,

  -- Opaque billing reference for audit (the cancelled Stripe subscription id).
  -- No customer id, email or payment data is retained here.
  billing_ref text,

  -- Recipient for the final confirmation, captured at request time so the worker
  -- can queue it without the original session. Cleared at `completed`.
  recipient_email text,

  -- Residual tables the cascade left behind and the worker had to delete
  -- explicitly (categorical table names only — never row content).
  residual_tables text[] not null default '{}',

  -- Worker lease so two workers never process one job concurrently.
  worker_leased_until timestamptz,
  worker_run_id text,

  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Cheap due-work scan for the worker: unfinished jobs whose retry time has come.
create index if not exists account_deletion_requests_due_idx
  on public.account_deletion_requests (next_attempt_at)
  where status <> 'completed';

-- Support/audit correlation after the raw id is minimised away.
create index if not exists account_deletion_requests_hash_idx
  on public.account_deletion_requests (user_id_hash);

alter table public.account_deletion_requests enable row level security;
-- No policies: only the service role (which bypasses RLS) may touch this table.
-- The end user never reads it directly — status is exposed only through a
-- signed, short-lived receipt via the API, and carries no PII.

comment on table public.account_deletion_requests is
  'MW-V18-04: durable resumable account-deletion state machine. user_id has NO auth FK on purpose so the job survives identity deletion; minimised (user_id nulled, hash kept) at completion and purged after retention.';

-- ---------------------------------------------------------------------------
-- Atomic claim of due jobs, mirroring claim_due_emails (021): SKIP LOCKED so
-- overlapping workers never grab the same job; a lease bump means a crashed
-- worker's job comes due again after the lease expires.
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_deletion_jobs(
  p_limit int default 5,
  p_lease_minutes int default 5
) returns setof public.account_deletion_requests
language sql
security definer
set search_path = public
as $$
  update public.account_deletion_requests d
    set worker_leased_until = now() + make_interval(mins => p_lease_minutes),
        updated_at = now()
  where d.id in (
    select id from public.account_deletion_requests
    where status <> 'completed'
      and next_attempt_at <= now()
      and (worker_leased_until is null or worker_leased_until < now())
    order by next_attempt_at asc
    limit p_limit
    for update skip locked
  )
  returning d.*;
$$;

revoke all on function public.claim_due_deletion_jobs(int, int) from public, anon, authenticated;
grant execute on function public.claim_due_deletion_jobs(int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Ops: stuck-job stats for alerting. Counts only — never a user id or email.
-- "stuck" = not completed, past due, and has already failed at least twice.
-- ---------------------------------------------------------------------------
create or replace function public.account_deletion_stats(
  p_stuck_attempts int default 3
) returns table (
  open_jobs bigint,
  stuck_jobs bigint,
  oldest_open timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    count(*) filter (where status <> 'completed'),
    count(*) filter (
      where status <> 'completed'
        and attempts >= p_stuck_attempts
        and next_attempt_at <= now()
    ),
    min(requested_at) filter (where status <> 'completed')
  from public.account_deletion_requests;
$$;

revoke all on function public.account_deletion_stats(int) from public, anon, authenticated;
grant execute on function public.account_deletion_stats(int) to service_role;

-- ---------------------------------------------------------------------------
-- Privacy-safe operator retry: nudge one stuck job back to "due now" and clear
-- any stale lease, WITHOUT exposing or accepting any PII (request id only).
-- Refuses to touch a completed job. Returns the job's coarse status.
-- ---------------------------------------------------------------------------
create or replace function public.operator_retry_deletion(
  p_request_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  update public.account_deletion_requests
    set next_attempt_at = now(),
        worker_leased_until = null,
        updated_at = now()
  where id = p_request_id and status <> 'completed'
  returning status into v_status;

  return coalesce(v_status, 'not_found_or_completed');
end;
$$;

revoke all on function public.operator_retry_deletion(uuid) from public, anon, authenticated;
grant execute on function public.operator_retry_deletion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Retention/purge for the job ledger. Completed jobs are already minimised
-- (no user id, no email) but the operational record is dropped after the
-- window so nothing lingers indefinitely. Called from /api/cron/retention.
-- ---------------------------------------------------------------------------
create or replace function public.purge_completed_deletion_jobs(
  p_retain_days int default 30
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  delete from public.account_deletion_requests
  where status = 'completed'
    and completed_at is not null
    and completed_at < now() - make_interval(days => p_retain_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_completed_deletion_jobs(int) from public, anon, authenticated;
grant execute on function public.purge_completed_deletion_jobs(int) to service_role;

-- ===========================================================================
-- ROLLBACK / FORWARD-FIX
-- ---------------------------------------------------------------------------
-- Forward-fix is preferred: the code path is guarded by FLAG_ACCOUNT_DELETION_SYNC
-- (kill switch for the inline pass) and the worker is idempotent, so bugs are
-- fixed by redeploy without dropping anything.
--
-- Hard rollback (only if the table must be removed — will abandon in-flight
-- jobs, so drain them first by running the worker until account_deletion_stats
-- reports open_jobs = 0):
--   drop function if exists public.purge_completed_deletion_jobs(int);
--   drop function if exists public.operator_retry_deletion(uuid);
--   drop function if exists public.account_deletion_stats(int);
--   drop function if exists public.claim_due_deletion_jobs(int, int);
--   drop table if exists public.account_deletion_requests;
-- The previous inline route (MW-V17-04) can be restored from git history; it
-- needs no schema. Do NOT drop the table while any job is not 'completed'.
-- ===========================================================================
