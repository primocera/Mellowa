# MW-08 — Operational first-session value funnel

**Outcome:** New users reach one durable useful action quickly and measurably.
**Verdict:** completed (analytics wiring + tests). UX one-path was already in place.

## Before

`src/lib/today/first-session.ts` (canonical milestones + 30-min window metric)
was imported only by the experiments modules — **not** by the analytics report.
The first-session funnel was a test-only helper, not a live metric.

## Change

- **`first-session.ts`**: added the pure aggregator `firstSessionScorecard(sessions,
  now, windowMin, minCohort)` — denominator = users who entered the funnel (have
  onboarding/check-in/plan), milestone reach counts, and first-value split into
  **reached / pending / missed** (pending = window still open, never conflated
  with missed). Small cohorts are suppressed.
- **`src/lib/analytics/report.ts`**: `buildMetricsReport` groups live `app_events`
  per user, drops staff/test/demo via the server-owned exclusion registry, and
  computes `firstSession`. Added `firstSession` to `MetricsReport` and CSV
  (`first_session*` rows; suppressed cohorts export no breakdown).
- **`src/app/admin/page.tsx`**: a "First session (value within 30 min)" card —
  entered count, per-milestone reach, and reached/pending/missed (or "—" when
  suppressed).

## Already correct (verified, not changed)

- A served fallback emits `plan_fallback_served` → counts as **plan_created** but
  is **not** in `VALUE_EVENTS`, so `first_value` still requires a durable action.
- `now_action_done` is emitted server-side after the completion row is saved
  (idempotent, post-durable-success) — clients cannot forge value.
- Views (`now_viewed`, `sample_plan_opened`) are excluded from value.

## Tests

- `tests/first-session.test.ts` (+4 MW-08 cases): milestone counts + reached/
  pending/missed split; fallback counts as plan_created but not value; open window
  stays pending; small cohort suppressed but size reported.
- Full suite counts in the commit message.

## Acceptance mapping

- first-session metrics computed from live event data, not a test-only helper — done.
- No view event inflates first_value — enforced by `VALUE_EVENTS` (durable only).
- Admin report distinguishes pending from failure — reached/pending/missed are separate.

## Rollback

Revert the report/admin/first-session changes; the pure milestone helpers are unchanged.
