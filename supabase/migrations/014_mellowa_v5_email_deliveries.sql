-- Prompt 2 (audit v5): durable, truthful transactional-email delivery ledger.
-- One row per logical email (event_key). Source state (e.g.
-- subscriptions.trial_reminder_sent) may only be marked after provider
-- acceptance; missing provider config is recorded as not_configured, never
-- treated as delivered.

create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  user_id uuid references auth.users (id) on delete cascade,
  template text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'not_configured', 'failed_transient', 'failed_permanent')),
  provider_id text,
  attempts integer not null default 0,
  scheduled_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_deliveries_status_idx
  on public.email_deliveries (status);
create index if not exists email_deliveries_user_idx
  on public.email_deliveries (user_id);

-- Service-role only: no user-facing policies. RLS enabled so the anon/auth
-- roles can never read or write delivery state.
alter table public.email_deliveries enable row level security;
