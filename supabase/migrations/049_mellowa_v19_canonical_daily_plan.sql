-- MW-02 (v19): canonical one-plan-per-user-per-local-day.
--
-- Until now nothing at the database level prevented two rows in daily_plans
-- from sharing the same (user_id, plan_date). The Today page already tolerates
-- this by showing only the newest matching row (MW-V10-07), but duplicates can
-- still exist — and each one cost a real generation. This migration makes the
-- canonical plan a hard invariant WITHOUT deleting any user history:
--
--   * adds a nullable `superseded_at` marker (additive, RLS inherits from the
--     table's existing policies);
--   * reconciles pre-existing duplicates by keeping the NEWEST row per
--     (user_id, plan_date) canonical and marking older siblings superseded —
--     the rows stay readable as history, they are simply no longer "the plan";
--   * enforces a PARTIAL unique index so at most one non-superseded plan can
--     exist per user and local date going forward.
--
-- Additive and idempotent: re-running is safe. No row is deleted. Reversible by
-- dropping the index and column (see rollback note at the bottom).

-- 1. Marker column (additive).
alter table public.daily_plans
  add column if not exists superseded_at timestamptz;

comment on column public.daily_plans.superseded_at is
  'MW-02: when non-null, this plan was superseded by a newer canonical plan for the same user/local date. Kept as readable history; excluded from the canonical unique index.';

-- 2. PREFLIGHT (run manually before applying to inspect scope):
--    how many (user_id, plan_date) groups currently hold >1 live plan?
--
--    select count(*) as duplicate_groups from (
--      select user_id, plan_date
--        from public.daily_plans
--       where superseded_at is null
--       group by user_id, plan_date
--      having count(*) > 1
--    ) d;

-- 3. Reconcile existing duplicates: keep the newest row per (user_id, plan_date)
--    as canonical, mark the rest superseded. Deterministic ordering
--    (created_at desc, id desc) so it is stable and idempotent.
with ranked as (
  select id,
         row_number() over (
           partition by user_id, plan_date
           order by created_at desc, id desc
         ) as rn
    from public.daily_plans
   where superseded_at is null
)
update public.daily_plans p
   set superseded_at = now()
  from ranked r
 where p.id = r.id
   and r.rn > 1;

-- 4. Canonical constraint: one live plan per user per local date.
create unique index if not exists daily_plans_user_date_canonical
  on public.daily_plans (user_id, plan_date)
  where superseded_at is null;

-- 5. VERIFICATION (must return zero rows after applying):
--
--    select user_id, plan_date, count(*)
--      from public.daily_plans
--     where superseded_at is null
--     group by user_id, plan_date
--    having count(*) > 1;

-- Rollback (data-safe):
--   drop index if exists public.daily_plans_user_date_canonical;
--   -- superseded_at may be left in place (harmless) or:
--   -- alter table public.daily_plans drop column if exists superseded_at;
