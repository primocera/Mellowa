-- MW-S07 (v8): the free sample includes ONE bounded, non-AI adjustment.
--
-- The sample tier may swap one curated (non-meal) section — movement, calm
-- reset or evening wind-down — exactly once per account, so the sample
-- demonstrates the adaptive loop without a provider cost. The claim is a
-- conditional single-row update (used_at is null), which is atomic.

alter table public.wellbeing_profiles
  add column if not exists sample_adjustment_used_at timestamptz;
