-- MW-S05 (v8): meal continuity preferences.
--
-- Optional, user-editable planning preferences that let weekly generation
-- reuse saved favourites and leftovers and let the shopping draft skip items
-- already on hand. Practical planning data only — never nutrition targets,
-- calories or health context. Lives on wellbeing_profiles (already covered by
-- RLS and the privacy registry/export/delete).

alter table public.wellbeing_profiles
  add column if not exists meal_reuse_favourites boolean not null default false,
  add column if not exists meal_repeat_leftovers boolean not null default false,
  add column if not exists meal_variety_level text
    check (meal_variety_level in ('keep_it_similar','some_variety','lots_of_variety')),
  add column if not exists pantry_items text[] not null default '{}';
