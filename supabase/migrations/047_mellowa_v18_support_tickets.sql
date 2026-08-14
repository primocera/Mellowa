-- MW-V18-08: privacy-safe support-burden measurement.
--
-- Paid readiness must not be declared with support = UNAVAILABLE (the cohort
-- scorecard's support_burden row). This adds a minimal, PRIVACY-SAFE ticket
-- ledger: categories, severities, timings and cohort — and deliberately NO
-- message body, subject or free text. It is enough to quantify support load per
-- mature cohort without ever storing what a user wrote about their wellbeing.
--
-- Service-role only (RLS on, no policies). The account link is ON DELETE SET
-- NULL so the aggregate category survives an account deletion while the user
-- link is removed (same posture as app_events anonymisation).
--
-- Additive, re-runnable. Rollback needs no reversal.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  -- The support tool's own ticket id. UNIQUE so re-importing the same ticket is
  -- idempotent (an update, never a duplicate contact).
  external_ref text unique,
  -- Same-issue grouping key, e.g. "<user>:<category>:<week>". Repeated contacts
  -- about one issue share it, so "contacts per 100 users" counts issues, not
  -- individual messages.
  dedupe_key text not null,
  -- Opaque account link; nullable and SET NULL on deletion. No email, no body.
  account_user_id uuid references public.profiles(id) on delete set null,
  category text not null,
  severity text not null default 'normal',
  product_area text,
  -- Cohort/plan at time of contact: free | trial | paid | unknown.
  plan text not null default 'unknown',
  channel text,
  status text not null default 'open',
  reopened_count int not null default 0,
  first_response_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint support_tickets_category_chk check (category in (
    'access_auth', 'billing', 'plan_generation_failure', 'repair_confusion',
    'safety_concern', 'account_deletion', 'bug', 'feature_request', 'other'
  )),
  constraint support_tickets_severity_chk check (severity in (
    'low', 'normal', 'high', 'critical'
  )),
  constraint support_tickets_plan_chk check (plan in (
    'free', 'trial', 'paid', 'unknown'
  )),
  constraint support_tickets_status_chk check (status in (
    'open', 'pending', 'resolved', 'reopened', 'closed'
  ))
);

create index if not exists support_tickets_dedupe_idx on public.support_tickets (dedupe_key);
create index if not exists support_tickets_created_idx on public.support_tickets (created_at);

comment on table public.support_tickets is
  'MW-V18-08 privacy-safe support-burden ledger: category/severity/timings/plan '
  'only. NO message body, subject or free text. Service-role only.';

alter table public.support_tickets enable row level security;
