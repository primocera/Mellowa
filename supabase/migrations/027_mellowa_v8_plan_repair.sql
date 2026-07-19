-- MW-S02 (v8): atomic remaining-day repair with reversible plan versions.
--
-- daily_plan_versions stores a snapshot of ONLY the section columns a repair
-- replaced, so Undo can restore the prior state without another AI call.
-- apply_plan_repair snapshots + updates in ONE transaction (a SQL function
-- body is atomic): a repair either commits fully or not at all.

create table if not exists public.daily_plan_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_plan_id uuid not null references public.daily_plans(id) on delete cascade,
  version integer not null,
  -- Prior values of the replaced columns only, keyed by column name.
  sections jsonb not null,
  repair_reason text not null check (repair_reason in (
    'less_time','lower_energy','context_changed','meal_not_working','calmer_version','undo'
  )),
  changed_sections text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (daily_plan_id, version)
);

create index if not exists daily_plan_versions_plan_idx
  on public.daily_plan_versions (daily_plan_id, version desc);

alter table public.daily_plan_versions enable row level security;

drop policy if exists "plan versions select own" on public.daily_plan_versions;
create policy "plan versions select own" on public.daily_plan_versions
  for select using (auth.uid() = user_id);
drop policy if exists "plan versions insert own" on public.daily_plan_versions;
create policy "plan versions insert own" on public.daily_plan_versions
  for insert with check (auth.uid() = user_id);
drop policy if exists "plan versions delete own" on public.daily_plan_versions;
create policy "plan versions delete own" on public.daily_plan_versions
  for delete using (auth.uid() = user_id);

-- Allowed repairable columns; anything else in p_updates is ignored.
-- SECURITY INVOKER: runs as the calling user, so RLS on both tables applies.
create or replace function public.apply_plan_repair(
  p_user_id uuid,
  p_plan_id uuid,
  p_updates jsonb,
  p_reason text,
  p_changed text[]
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_plan public.daily_plans%rowtype;
  v_snapshot jsonb := '{}'::jsonb;
  v_version integer;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'not_owner';
  end if;

  select * into v_plan
    from public.daily_plans
   where id = p_plan_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'plan_not_found';
  end if;

  if p_updates ? 'meal_cards' then
    v_snapshot := v_snapshot || jsonb_build_object('meal_cards', to_jsonb(v_plan.meal_cards));
  end if;
  if p_updates ? 'movement_plan' then
    v_snapshot := v_snapshot || jsonb_build_object('movement_plan', to_jsonb(v_plan.movement_plan));
  end if;
  if p_updates ? 'breathing_exercise' then
    v_snapshot := v_snapshot || jsonb_build_object('breathing_exercise', to_jsonb(v_plan.breathing_exercise));
  end if;
  if p_updates ? 'meditation_or_reflection' then
    v_snapshot := v_snapshot || jsonb_build_object('meditation_or_reflection', to_jsonb(v_plan.meditation_or_reflection));
  end if;
  if p_updates ? 'relaxation_technique' then
    v_snapshot := v_snapshot || jsonb_build_object('relaxation_technique', to_jsonb(v_plan.relaxation_technique));
  end if;
  if p_updates ? 'focus_plan' then
    v_snapshot := v_snapshot || jsonb_build_object('focus_plan', to_jsonb(v_plan.focus_plan));
  end if;
  if p_updates ? 'evening_routine' then
    v_snapshot := v_snapshot || jsonb_build_object('evening_routine', to_jsonb(v_plan.evening_routine));
  end if;
  if p_updates ? 'habit_focus' then
    v_snapshot := v_snapshot || jsonb_build_object('habit_focus', to_jsonb(v_plan.habit_focus));
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.daily_plan_versions
   where daily_plan_id = p_plan_id;

  insert into public.daily_plan_versions
    (user_id, daily_plan_id, version, sections, repair_reason, changed_sections)
  values
    (p_user_id, p_plan_id, v_version, v_snapshot, p_reason, coalesce(p_changed, '{}'));

  update public.daily_plans set
    meal_cards = case when p_updates ? 'meal_cards' then p_updates->'meal_cards' else meal_cards end,
    movement_plan = case when p_updates ? 'movement_plan' then p_updates->'movement_plan' else movement_plan end,
    breathing_exercise = case when p_updates ? 'breathing_exercise' then p_updates->'breathing_exercise' else breathing_exercise end,
    meditation_or_reflection = case when p_updates ? 'meditation_or_reflection' then p_updates->'meditation_or_reflection' else meditation_or_reflection end,
    relaxation_technique = case when p_updates ? 'relaxation_technique' then p_updates->'relaxation_technique' else relaxation_technique end,
    focus_plan = case when p_updates ? 'focus_plan' then p_updates->'focus_plan' else focus_plan end,
    evening_routine = case when p_updates ? 'evening_routine' then p_updates->'evening_routine' else evening_routine end,
    habit_focus = case when p_updates ? 'habit_focus' then p_updates->'habit_focus' else habit_focus end
  where id = p_plan_id and user_id = p_user_id;

  return v_version;
end;
$$;

-- Undo: restore the newest snapshot and remove it. Idempotent — with no
-- versions left it returns null and changes nothing. Never calls AI.
create or replace function public.undo_plan_repair(
  p_user_id uuid,
  p_plan_id uuid
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
    return null;
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

grant execute on function public.apply_plan_repair(uuid, uuid, jsonb, text, text[]) to authenticated;
grant execute on function public.undo_plan_repair(uuid, uuid) to authenticated;
