-- MW-V9-04 (v9): version-checked Undo for plan repair.
--
-- Additive overload of undo_plan_repair that only restores when the newest
-- snapshot's version matches what the caller last saw. A stale tab (or a
-- double-tap racing a newer repair) gets a clean 'version_conflict' error
-- instead of silently unwinding a repair it never showed the user.
-- The two-argument form from migration 027 is unchanged.

create or replace function public.undo_plan_repair(
  p_user_id uuid,
  p_plan_id uuid,
  p_expected_version integer
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.daily_plan_versions%rowtype;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'not_owner';
  end if;

  select * into v_row
    from public.daily_plan_versions
   where daily_plan_id = p_plan_id and user_id = p_user_id
   order by version desc
   limit 1
   for update;
  if not found then
    -- Nothing to undo (already undone in another tab): idempotent no-op.
    return null;
  end if;

  if v_row.version is distinct from p_expected_version then
    raise exception 'version_conflict';
  end if;

  update public.daily_plans set
    meal_cards = case when v_row.sections ? 'meal_cards' then v_row.sections->'meal_cards' else meal_cards end,
    movement_plan = case when v_row.sections ? 'movement_plan' then v_row.sections->'movement_plan' else movement_plan end,
    breathing_exercise = case when v_row.sections ? 'breathing_exercise' then v_row.sections->'breathing_exercise' else breathing_exercise end,
    meditation_or_reflection = case when v_row.sections ? 'meditation_or_reflection' then v_row.sections->'meditation_or_reflection' else meditation_or_reflection end,
    relaxation_technique = case when v_row.sections ? 'relaxation_technique' then v_row.sections->'relaxation_technique' else relaxation_technique end,
    focus_plan = case when v_row.sections ? 'focus_plan' then v_row.sections->'focus_plan' else focus_plan end,
    evening_routine = case when v_row.sections ? 'evening_routine' then v_row.sections->'evening_routine' else evening_routine end,
    habit_focus = case when v_row.sections ? 'habit_focus' then v_row.sections->'habit_focus' else habit_focus end
  where id = p_plan_id and user_id = p_user_id;

  delete from public.daily_plan_versions where id = v_row.id;

  return v_row.version;
end;
$$;

grant execute on function public.undo_plan_repair(uuid, uuid, integer) to authenticated;
