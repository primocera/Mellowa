-- MW-V18-05: canonical cohort facts & mature metric math.
--
-- Two durable, full-history sources so cohort reporting is no longer computed
-- from a rolling 30-day app_events slice (which mis-activates any user whose
-- true first check-in fell outside the window, and cannot see lifetime-first
-- facts at all):
--
--   1. analytics_activation_facts — the canonical activation fact per user,
--      derived from the full history of daily_checkins (a durable, user-owned,
--      cascade-deleted table), not from the analytics event stream. Activation
--      is a user's FIRST check-in; occurred_at and the user-local calendar date
--      are both preserved.
--
--   2. analytics_excluded_users — a SERVER-OWNED staff/test/demo exclusion
--      registry. Production cohort reports read exclusions from here instead of
--      trusting caller-supplied UI ids, so a staff account can never silently
--      inflate an activation or conversion denominator.
--
-- Additive and re-runnable. No existing column is altered.

-- --- canonical activation fact (full history) --------------------------------

-- Make the per-user "earliest check-in" scan cheap at any table size.
create index if not exists daily_checkins_user_created_idx
  on public.daily_checkins (user_id, created_at);

-- A view, not a materialized table: activation is a pure aggregate of an
-- append-mostly table, so it is always live and needs no backfill job. It reads
-- the whole history of daily_checkins, so a user who activated a year ago is
-- still counted with their true activation instant and local calendar date.
--
-- security_invoker = true: the view runs with the QUERYING role's privileges and
-- RLS, not the definer's. Server-side cohort math uses the service role (which
-- bypasses RLS), so it is unaffected; but an anon/authenticated caller can never
-- use this view to read check-in rows their own RLS would hide. Without this,
-- Postgres defaults a view to definer rights, which the Supabase linter flags.
create or replace view public.analytics_activation_facts
  with (security_invoker = true) as
  select
    user_id,
    min(created_at)                                   as activated_at,
    min(checkin_date)                                 as activation_local_date,
    count(*)                                          as checkins_total
  from public.daily_checkins
  group by user_id;

comment on view public.analytics_activation_facts is
  'MW-V18-05 canonical activation fact: first check-in per user across full '
  'history. activated_at is the immutable occurred_at; activation_local_date is '
  'the user-local calendar day. Read server-side only for cohort math.';

-- --- server-owned staff/test/demo exclusion registry -------------------------

create table if not exists public.analytics_excluded_users (
  -- Deliberately NO foreign key to auth/profiles: this is an ops registry that
  -- must survive an excluded account's deletion (so a deleted staff account is
  -- still excluded from historical cohorts) and holds no user-authored content.
  user_id    uuid primary key,
  -- Why the id is excluded, for auditability: 'staff' | 'test' | 'demo' | free.
  kind       text not null default 'staff',
  reason     text not null,
  added_by   text,
  created_at timestamptz not null default now()
);

comment on table public.analytics_excluded_users is
  'MW-V18-05 server-owned exclusion registry (staff/test/demo). Cohort reports '
  'exclude these ids; never populated from client input. No PII, no user content.';

-- Service-role only: RLS enabled with NO policies, so anon/authenticated users
-- can neither read nor write it. Only the admin (service-role) client, which
-- bypasses RLS, touches it — the same posture as account_deletion_requests.
alter table public.analytics_excluded_users enable row level security;
