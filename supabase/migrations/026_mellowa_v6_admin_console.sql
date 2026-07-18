-- Launch & Scale v6, Prompt 17 — support/admin console.

-- Every admin view/action is recorded: actor, action, target, reason, when.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  action text not null,
  target_user_id uuid,
  reason text not null default '',
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;
-- No policies: only the service role (admin API routes) can read/write.

create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log (target_user_id, created_at desc);

-- Operator flags on an account: billing review + generation abuse switch.
create table if not exists public.account_flags (
  user_id uuid primary key references auth.users(id) on delete cascade,
  billing_review boolean not null default false,
  generation_disabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.account_flags enable row level security;
-- No policies: service-role only. Users never see or set their own flags.
