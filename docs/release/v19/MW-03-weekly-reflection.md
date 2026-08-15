# MW-03 — Timezone-correct previous-week reflection and carry-forward

**Outcome:** Week closes only after the actual local week is complete.
**Verdict:** completed (code + tests). No migration needed.

## The bugs (all confirmed in code)

`src/app/api/week/reflection/route.ts` (GET + POST) determined week identity from
**server-local** `startOfWeek(new Date(), { weekStartsOn: 1 })` and summarised a
**rolling 7 days** (`created_at >= subDays(now, 7)`), labelling the *current*
in-progress week — so a user could "close out the week" mid-week, and the facts
were a rolling window, not a real week. This is exactly what MW-03 forbids.

`src/lib/weekly/window.ts` (the correct timezone-safe module) existed but had
**no production caller**.

## Changes

- **`src/lib/week/reflection.ts`**: extracted fact-building behind a predicate and
  added `weeklyFactsForWindow(inputs, weekStartYmd, tz)` + `isInLocalWeek(iso, weekStartYmd, tz)`
  — classify each row by its LOCAL calendar date and include it only if it falls
  in the exact Monday-Sunday week. The old rolling `weeklyFacts` is retained for
  back-compat but is no longer on the live path.
- **`src/app/api/week/reflection/route.ts`**:
  - resolves the user's stored IANA timezone server-side (UTC fallback);
  - uses `reflectionWindow(now, tz)` → the reflection is about the **previous
    completed** week (`reflectionWeekStart`); the target it shapes is the current
    week (`currentWeekStart`);
  - facts computed from a UTC superset query then `weeklyFactsForWindow` (exact
    local boundaries) — no more `created_at >= now-7d`;
  - GET returns `week_start` (source), `week_end`, `target_week_start`,
    `current_week_start`, `state` (available/completed) and the saved reflection;
  - POST saves for the completed source week, is idempotent per `(user, week_start)`,
    and **refuses** a client-declared `week_start` that isn't the current completed
    week with `409 stale_week` (page loaded across a boundary, or forged target).
- **`src/components/dailyflow/weekly-reflection.tsx`**: heading changed from
  "Close out the week" to "Reflect on last week · <exact range>", with a quiet
  note that the in-progress week stays open. Offset-free range formatting from the
  YYYY-MM-DD strings.

## Data model note

No migration. `weekly_reflections.week_start` continues to mean "the week this
reflection is about"; the change is *which* week that is (the completed one) and
*when* it becomes available (only after it ends). Existing rows remain valid and
readable. The weekly-plan generator already carries forward the latest reflection
within 14 days — unchanged, still one mapping (`reflectionSelectionsFromRow` →
`reflectionToWeeklyHints`).

## Tests

- `tests/weekly-facts-window.test.ts` (new, 6 cases): Sunday 23:59 vs Monday 00:00
  local membership, week-start inclusion, UTC+14 (Kiritimati) vs UTC-12, malformed
  timestamp, in-week counting, sparse week → no invented facts.
- Existing `weekly-reflection`, `weekly-window`, `week-copy`, `weekly-paid-value-memo`
  suites still green (44). Full suite counts in the commit message.

## Acceptance mapping

- No server-local `startOfWeek(new Date())` decides week identity — removed.
- No rolling-7-day metric labelled a completed week — replaced with exact local boundaries.
- Current week stays pending until local Monday begins the next week — reflection targets the previous week; UI states the current week stays open.
- Preview, saved row, personalization and weekly prompt use one mapping — unchanged, still `reflectionSelectionsFromRow`.

## Rollback

Revert the route/component/lib changes; no schema change to undo.
