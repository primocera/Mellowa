-- Launch & Scale v6, Prompt 16 — DB scale, RLS/RPC hardening, timeouts.

-- 1. RPC authorization fix: claim_ai_generation was executable by any
-- authenticated user with a caller-chosen p_user_id and caller-chosen
-- limits/cost — allowing rate-limit burn on another user and global-ceiling
-- spam. The app now calls it with the service role only (src/lib/ai/rate-limit.ts).
revoke all on function public.claim_ai_generation(uuid, text, int, int, numeric, numeric) from public;
revoke all on function public.claim_ai_generation(uuid, text, int, int, numeric, numeric) from anon;
revoke all on function public.claim_ai_generation(uuid, text, int, int, numeric, numeric) from authenticated;
grant execute on function public.claim_ai_generation(uuid, text, int, int, numeric, numeric) to service_role;

-- claim/finish_generation_request keep their authenticated grant: they verify
-- auth.uid() = p_user_id in the function body (020).

-- 2. Evidence-based indexes for hot paths:
-- trial-reminders queue scan (status + reminder flag + due window)
create index if not exists subscriptions_trial_due_idx
  on public.subscriptions (trial_end)
  where status = 'trialing' and trial_reminder_sent = false;

-- per-user event history (analytics attribution, export); the existing
-- app_events_event_time_idx covers funnel scans by event name.
create index if not exists app_events_user_time_idx
  on public.app_events (user_id, created_at desc)
  where user_id is not null;

-- 3. Safe statement timeouts per role: a runaway query can't hold a
-- connection hostage. Vercel functions already cap request time.
alter role authenticated set statement_timeout = '5s';
alter role anon set statement_timeout = '3s';
alter role service_role set statement_timeout = '30s';
