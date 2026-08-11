-- Mellowa v17 — MW-V17-06: exactly-once onboarding completion.
-- Run in Supabase SQL Editor after 042_mellowa_v13_subscription_currency.sql.
--
-- The onboarding-complete route used a read-then-write check, so two concurrent
-- or retried completions could both record the milestone. This adds a durable,
-- exactly-once completion authority: one row per user, enforced by the primary
-- key. The route inserts here and treats a unique violation (23505) as an
-- idempotent "already completed". Purely additive, idempotent, non-destructive —
-- a flag-based rollback needs no reversal.

create table if not exists public.onboarding_completions (
  -- One completion per user, forever. The PK is the exactly-once guarantee.
  user_id uuid primary key references public.profiles(id) on delete cascade,
  completed_at timestamptz not null default now()
);

-- Server-only writes/reads via the service role; the user never reads or writes
-- this directly, so there are no user-facing policies (fail-closed by default).
alter table public.onboarding_completions enable row level security;
