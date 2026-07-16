-- Prompt 7 (audit v5): nutrition estimates are an explicit adult opt-in.
-- Default becomes FALSE; existing users who never made an explicit choice
-- are switched to hidden (they can opt back in from Settings or any meal
-- card). Mellowa is not a calorie/macro tracking app.

alter table public.wellbeing_profiles
  alter column show_macros set default false;

update public.wellbeing_profiles set show_macros = false
  where show_macros is null;
