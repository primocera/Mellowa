-- MW-S03 (v8): user-controlled memory — learned-signal suppression boundary.
--
-- Removing a learned signal no longer deletes the user's feedback history.
-- Instead a suppression row marks a boundary: feedback at or before
-- suppressed_at is ignored when deriving that signal, so it cannot reappear
-- until the threshold is met again from NEWER feedback. Deleting the
-- suppression row is the free Undo.

create table if not exists public.learned_signal_suppressions (
  user_id uuid not null references auth.users(id) on delete cascade,
  signal text not null check (signal in (
    'not_for_me','too_much','too_little_time','didnt_fit_food'
  )),
  suppressed_at timestamptz not null default now(),
  primary key (user_id, signal)
);

alter table public.learned_signal_suppressions enable row level security;

drop policy if exists "suppressions select own" on public.learned_signal_suppressions;
create policy "suppressions select own" on public.learned_signal_suppressions
  for select using (auth.uid() = user_id);
drop policy if exists "suppressions insert own" on public.learned_signal_suppressions;
create policy "suppressions insert own" on public.learned_signal_suppressions
  for insert with check (auth.uid() = user_id);
drop policy if exists "suppressions update own" on public.learned_signal_suppressions;
create policy "suppressions update own" on public.learned_signal_suppressions
  for update using (auth.uid() = user_id);
drop policy if exists "suppressions delete own" on public.learned_signal_suppressions;
create policy "suppressions delete own" on public.learned_signal_suppressions
  for delete using (auth.uid() = user_id);
