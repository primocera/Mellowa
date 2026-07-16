-- Prompt 6 (audit v5): adult-only age gate and versioned consent.
-- One row per consent grant; re-consent after a policy version change adds a
-- new row, keeping a full audit trail. No date of birth is collected.

create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  consent_type text not null
    check (consent_type in ('age_18_plus', 'terms', 'privacy', 'reminders_marketing')),
  version text not null,
  granted boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists user_consents_user_idx
  on public.user_consents (user_id, consent_type, created_at desc);

alter table public.user_consents enable row level security;

create policy "Users read own consents"
  on public.user_consents for select
  using (auth.uid() = user_id);

create policy "Users record own consents"
  on public.user_consents for insert
  with check (auth.uid() = user_id);
