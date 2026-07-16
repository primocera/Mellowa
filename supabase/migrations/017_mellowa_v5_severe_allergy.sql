-- Prompt 8 (audit v5): explicit severe-allergy flag. When set (or when a
-- severe signal is detected in free text), no specific meals are generated.

alter table public.wellbeing_profiles
  add column if not exists allergies_severe boolean not null default false;
