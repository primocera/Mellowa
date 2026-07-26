-- MW-V10-06 (v10): capped beta intake + stop-acquisition switch.
--
-- The v9 funnel can measure acquisition but cannot gate it. "≤50 invites" was a
-- number in a document, enforced by nobody: nothing in the product stopped the
-- 51st signup, and there was no way to stop intake at all if a stop criterion
-- (unsafe output, duplicate charge, privacy leak, reminder complaints) fired.
--
-- Enforcement lives HERE, in the trigger that runs on every new auth user,
-- rather than in the signup form. The form calls supabase.auth.signUp from the
-- browser, so a UI check is a courtesy, not a cap — anyone can call the auth
-- endpoint directly. A database trigger is the only place the limit is real.
--
-- Nothing is ever deleted by closing intake: the switch only blocks NEW rows.
-- Existing users, their plans and their subscriptions are untouched, so a stop
-- is instantly reversible by flipping the flag back.

create table if not exists public.beta_settings (
  -- Single-row table; the check keeps it that way.
  id boolean primary key default true,
  constraint beta_settings_singleton check (id),
  /** Master switch. false = no new accounts, whatever the cap says. */
  signups_open boolean not null default true,
  /** Maximum accounts admitted to the beta. NULL = uncapped. */
  invite_cap int,
  /** Free-text reason an owner turned intake off, for the ops log. */
  closed_reason text,
  updated_at timestamptz not null default now()
);

alter table public.beta_settings enable row level security;
-- No policies: service role only. Users never read or write this.

-- Default: open, capped at 50, matching the documented beta size.
insert into public.beta_settings (id, signups_open, invite_cap)
values (true, true, 50)
on conflict (id) do nothing;

/**
 * Current intake state. `used` counts real accounts, so deleting a test account
 * frees a slot — the cap is about live users, not lifetime signups.
 */
create or replace function public.beta_capacity()
returns table (signups_open boolean, invite_cap int, used int, remaining int)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.signups_open,
    s.invite_cap,
    (select count(*)::int from public.profiles) as used,
    case
      when s.invite_cap is null then null
      else greatest(s.invite_cap - (select count(*)::int from public.profiles), 0)
    end as remaining
  from public.beta_settings s
  where s.id;
$$;

/**
 * Block a new account when intake is closed or full.
 *
 * Runs BEFORE the profile insert in handle_new_user. The exception aborts the
 * auth.users insert too, so no half-created account is left behind.
 *
 * The message codes are stable strings the app maps to user-facing copy —
 * never shown raw, and they leak nothing about how full the beta is.
 */
create or replace function public.enforce_beta_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open boolean;
  v_cap int;
  v_used int;
begin
  select s.signups_open, s.invite_cap into v_open, v_cap
  from public.beta_settings s where s.id;

  -- No settings row = no beta gate configured. Fail OPEN: an unconfigured
  -- table must never lock every new user out of the product.
  if v_open is null then
    return new;
  end if;

  if not v_open then
    raise exception 'beta_signups_closed' using errcode = 'check_violation';
  end if;

  if v_cap is not null then
    select count(*)::int into v_used from public.profiles;
    if v_used >= v_cap then
      raise exception 'beta_capacity_reached' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_beta_gate on auth.users;
create trigger on_auth_user_beta_gate
  before insert on auth.users
  for each row execute function public.enforce_beta_capacity();

revoke all on function public.beta_capacity() from public, anon, authenticated;

comment on table public.beta_settings is
  'MW-V10-06: capped beta intake. Closing intake blocks NEW accounts only — no existing data is touched, so a stop is instantly reversible.';
