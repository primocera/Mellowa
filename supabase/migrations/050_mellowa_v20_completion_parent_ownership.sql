-- MW-01 (v20): plan_completions parent-ownership integrity.
--
-- Background. plan_completions (migration 004) carries a GLOBAL unique key
-- `(daily_plan_id, item_key)` and RLS that only checks `auth.uid() = user_id`.
-- Nothing verified that the referenced daily_plans row actually belongs to the
-- writer. Consequences at review time:
--
--   * An attacker who learns a victim's daily_plan_id could insert a row
--     (attacker_id, victim_plan_id, item_key) — passing the own-user check —
--     and thereby OCCUPY the victim's global unique slot. The victim's own
--     upsert then hits ON CONFLICT DO UPDATE on a row it may not update, so RLS
--     denies it and the legitimate owner is denial-of-serviced on that item.
--   * The owner's normal idempotent re-complete relies on ON CONFLICT DO UPDATE
--     but no UPDATE policy existed, so the upsert path was fragile.
--
-- This migration closes both at the database layer, additively and idempotently:
--
--   1. Adds parent-ownership to INSERT (and UPDATE) RLS via an EXISTS check on
--      daily_plans. Under authenticated PostgREST writes the policy predicate is
--      evaluated as the calling user; the EXISTS subquery reads daily_plans
--      under that user's own SELECT policy, which returns TRUE only for a plan
--      the user owns (superseded or not) and FALSE for a foreign plan — so a
--      foreign daily_plan_id can never satisfy the check. service_role (server
--      trusted paths) bypasses RLS as before.
--   2. Adds the missing UPDATE policy so the owner's idempotent upsert has a
--      working policy path, while a foreigner's does not.
--   3. Repairs any pre-existing provably-invalid rows (user_id <> the parent
--      plan's owner) so a malicious/inconsistent row planted before this
--      migration cannot keep blocking the legitimate owner. These rows are
--      illegitimate BY CONSTRUCTION — a completion can only ever belong to the
--      plan's owner — so the deterministic rule is: delete exactly those rows.
--      No completion is ever reassigned to a guessed user. The count is emitted
--      via RAISE NOTICE (owner-visible report); PREFLIGHT/VERIFY queries below
--      let the owner confirm scope before and zero after.
--
-- The global unique `(daily_plan_id, item_key)` is intentionally KEPT: once a
-- foreign row can no longer exist, a daily_plan_id maps to exactly one owner,
-- so the global key is equivalent to a per-owner key and still guarantees one
-- current completion per owned plan/item.

-- ---------------------------------------------------------------------------
-- 1 + 2. Ownership-aware RLS.
-- ---------------------------------------------------------------------------
drop policy if exists "plan_completions_insert_own" on public.plan_completions;
create policy "plan_completions_insert_own" on public.plan_completions
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.daily_plans dp
       where dp.id = plan_completions.daily_plan_id
         and dp.user_id = auth.uid()
    )
  );

-- UPDATE policy so the owner's ON CONFLICT DO UPDATE (idempotent re-complete)
-- has a working path; parent-ownership enforced on both the existing row (USING)
-- and the proposed row (WITH CHECK).
drop policy if exists "plan_completions_update_own" on public.plan_completions;
create policy "plan_completions_update_own" on public.plan_completions
  for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.daily_plans dp
       where dp.id = plan_completions.daily_plan_id
         and dp.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.daily_plans dp
       where dp.id = plan_completions.daily_plan_id
         and dp.user_id = auth.uid()
    )
  );

-- SELECT / DELETE remain own-user (a delete can only ever touch the caller's
-- own rows, and after the repair below no cross-owner row exists).

-- ---------------------------------------------------------------------------
-- 3. PREFLIGHT (run manually before applying to inspect scope):
--
--    select count(*) as invalid_completions
--      from public.plan_completions pc
--      join public.daily_plans dp on dp.id = pc.daily_plan_id
--     where pc.user_id <> dp.user_id;
--
--    -- (also count orphan rows whose parent plan no longer exists — none can
--    --  exist because of the ON DELETE CASCADE FK, but verify anyway:)
--    select count(*) as orphan_completions
--      from public.plan_completions pc
--     where not exists (select 1 from public.daily_plans dp where dp.id = pc.daily_plan_id);
-- ---------------------------------------------------------------------------

-- Deterministic repair: delete completions whose user_id does not match the
-- parent plan's owner. Emits the affected count as an owner-visible report.
do $$
declare
  v_invalid bigint;
begin
  select count(*) into v_invalid
    from public.plan_completions pc
    join public.daily_plans dp on dp.id = pc.daily_plan_id
   where pc.user_id <> dp.user_id;

  if v_invalid > 0 then
    raise notice 'MW-01 repair: deleting % invalid plan_completions (user_id <> parent owner).', v_invalid;
    delete from public.plan_completions pc
     using public.daily_plans dp
     where dp.id = pc.daily_plan_id
       and pc.user_id <> dp.user_id;
  else
    raise notice 'MW-01 repair: no invalid plan_completions found.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- VERIFICATION (must return zero after applying):
--
--    select count(*) from public.plan_completions pc
--      join public.daily_plans dp on dp.id = pc.daily_plan_id
--     where pc.user_id <> dp.user_id;
-- ---------------------------------------------------------------------------

-- Rollback (data-safe — restores the pre-MW-01 policies; the repair deletion of
-- illegitimate rows is intentionally NOT reversed):
--   drop policy if exists "plan_completions_update_own" on public.plan_completions;
--   drop policy if exists "plan_completions_insert_own" on public.plan_completions;
--   create policy "plan_completions_insert_own" on public.plan_completions
--     for insert with check (auth.uid() = user_id);
