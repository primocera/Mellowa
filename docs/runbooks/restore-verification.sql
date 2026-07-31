-- MW-V12-05 — restore verification (READ-ONLY).
--
-- Run against the SCRATCH project a backup was restored into — NEVER production.
-- Every statement is a SELECT: it creates nothing, changes nothing, deletes
-- nothing. It answers the seven checks in
-- docs/runbooks/key-rotation-and-backup.md → "Restore verification", so a
-- restore is verified with counts, not eyeballed by loading one page.
--
-- Paste the anonymized counts into the runbook's Result column and compare
-- against the production counts noted before the restore. Do NOT paste plan,
-- check-in or journal CONTENT — counts, ids and hashes only.
--
-- The table list mirrors USER_DATA_REGISTRY in src/lib/privacy/registry.ts.

-- ---------------------------------------------------------------------------
-- 1 · Row counts per user-owned table (silent truncation is the hidden failure)
-- ---------------------------------------------------------------------------
select 'profiles' as table_name, count(*) from public.profiles
union all select 'wellbeing_profiles', count(*) from public.wellbeing_profiles
union all select 'daily_checkins', count(*) from public.daily_checkins
union all select 'daily_plans', count(*) from public.daily_plans
union all select 'daily_plan_versions', count(*) from public.daily_plan_versions
union all select 'weekly_plans', count(*) from public.weekly_plans
union all select 'weekly_reflections', count(*) from public.weekly_reflections
union all select 'journal_entries', count(*) from public.journal_entries
union all select 'plan_completions', count(*) from public.plan_completions
union all select 'subscriptions', count(*) from public.subscriptions
union all select 'user_consents', count(*) from public.user_consents
union all select 'email_deliveries', count(*) from public.email_deliveries
order by table_name;

-- ---------------------------------------------------------------------------
-- 2 · Orphaned owners — rows whose user_id no longer resolves to an auth user.
--     Any non-zero count is a privacy problem (rows RLS cannot protect) AND the
--     signal that a restore resurrected a deleted account (check 6). Extend the
--     UNION with any table from the registry you want to prove.
-- ---------------------------------------------------------------------------
select 'wellbeing_profiles' as table_name, count(*) as orphaned
from public.wellbeing_profiles p
left join auth.users u on u.id = p.user_id
where u.id is null
union all
select 'daily_plans', count(*)
from public.daily_plans p left join auth.users u on u.id = p.user_id
where u.id is null
union all
select 'subscriptions', count(*)
from public.subscriptions p left join auth.users u on u.id = p.user_id
where u.id is null
union all
select 'journal_entries', count(*)
from public.journal_entries p left join auth.users u on u.id = p.user_id
where u.id is null
order by table_name;

-- ---------------------------------------------------------------------------
-- 3 · Reminder consent survived (fail-closed: a NULL means the user must
--     re-consent — safe, but a real behaviour change to know about).
-- ---------------------------------------------------------------------------
select
  count(*)                                            as profiles_total,
  count(reminder_consent_version)                     as consent_version_present,
  count(*) - count(reminder_consent_version)          as consent_version_null
from public.wellbeing_profiles;

-- ---------------------------------------------------------------------------
-- 4 · Allergy and dietary fields intact — the hard safety gate. A partial
--     restore here is the one that could hurt someone.
-- ---------------------------------------------------------------------------
select
  count(*)                                              as profiles_total,
  count(*) filter (where allergies is null)            as allergies_null,
  count(*) filter (where array_length(allergies, 1) > 0) as with_allergies,
  count(*) filter (where allergies_severe)             as severe_allergy_flag,
  count(*) filter (where food_preferences is null)     as food_prefs_null
from public.wellbeing_profiles;

-- ---------------------------------------------------------------------------
-- 5 · Subscriptions still map to Stripe — a lost mapping means paying users
--     without access. Counts only; never the ids themselves in evidence.
-- ---------------------------------------------------------------------------
select
  count(*)                                              as subscriptions_total,
  count(stripe_customer_id)                            as with_customer_id,
  count(stripe_subscription_id)                        as with_subscription_id,
  count(*) filter (where status in ('trialing','active')) as entitled_rows
from public.subscriptions;

-- ---------------------------------------------------------------------------
-- 6 · Deletion tombstones — a restore must NOT resurrect an account a user
--     asked to erase. There is no tombstone table by design (deletion cascades
--     from auth.users), so the detectable signal is check 2 (orphans) PLUS a
--     manual diff: for every deletion requested since the backup timestamp,
--     confirm the auth user and their rows are absent here. Record that diff.
--     This query lists auth users present in the restore for that comparison.
-- ---------------------------------------------------------------------------
select count(*) as auth_users_in_restore from auth.users;

-- ---------------------------------------------------------------------------
-- 7 · Plan versions and their snapshots restored together — a version whose
--     snapshot (sections) is empty makes Undo lie.
-- ---------------------------------------------------------------------------
select
  count(*)                                             as versions_total,
  count(*) filter (where sections = '{}'::jsonb)       as versions_without_snapshot,
  count(distinct daily_plan_id)                        as plans_with_versions
from public.daily_plan_versions;
