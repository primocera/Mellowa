-- MW-V18-05 follow-up: make analytics_activation_facts a security-INVOKER view.
--
-- Migration 045 created the view without an explicit security mode, so Postgres
-- defaulted it to definer rights (the Supabase "SECURITY DEFINER view" linter
-- finding). A definer-rights view over daily_checkins (an RLS-protected table)
-- could let a caller read rows their own RLS would hide. This recreates the view
-- with security_invoker = true so it enforces the QUERYING role's RLS instead.
--
-- Server-side cohort math uses the service role, which bypasses RLS regardless,
-- so this changes nothing for legitimate reads; it only closes the bypass for
-- anon/authenticated callers. The SELECT definition is unchanged from 045.
--
-- Additive and re-runnable (create or replace). Rollback needs no reversal.

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
  'the user-local calendar day. security_invoker=true so it enforces the '
  'querying role''s RLS. Read server-side only for cohort math.';
