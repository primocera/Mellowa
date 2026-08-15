# MW-02 — Canonical one-plan-per-user-per-local-day + stale-mutation protection

**Outcome:** No duplicate daily plan or stale-tab mutation at midnight, DST or concurrency.
**Verdict:** completed (code + tests + migration). Migration application is an owner action.

## What already existed (not re-done)

- `src/lib/today/plan-day.ts` — pure canonical-date/guard helpers (`planDateFor`, `classifyPlanDay`, `isRolloverNeeded`, `checkMutationAllowed`). Was **test-only** (zero prod callers).
- `src/lib/dates/local-day.ts` — the robust production date engine (DST-aware `resolvePlanDate`, `localDateFor`). The daily-plan route already resolves the plan date server-side from the stored IANA timezone.
- Today page (`(app)/today/page.tsx`, MW-V10-07) already refuses to show a non-today plan as "today" (compares `plan_date` to the resolved local date). **Acceptance "Yesterday can never be displayed as Today" was already met — left unchanged.**
- Idempotency ledger (`claimGenerationRequest`/`finishGenerationRequest`) already collapses same-key retries/double-clicks to one provider call.
- Repair/undo already transactional with version snapshots + `version_conflict` (migrations 027/034, `apply_plan_repair`/`undo_plan_repair`).

## The real gaps closed

1. **No DB canonical constraint** — two rows could share `(user_id, plan_date)`, each having cost a generation.
2. **No pre-generation existence check** — two *different* idempotency keys (two tabs / a double check-in submit) each generated and charged.
3. **No `not_today` guard on content mutations** — a tab open across local midnight could Adjust/regenerate *yesterday's* plan.

## Changes

- **`supabase/migrations/049_mellowa_v19_canonical_daily_plan.sql`** (additive, idempotent, non-destructive):
  - adds nullable `superseded_at` marker to `daily_plans`;
  - reconciles existing duplicates by keeping the newest row per `(user_id, plan_date)` canonical and marking older siblings `superseded_at` (history preserved, still readable);
  - partial unique index `daily_plans_user_date_canonical` on `(user_id, plan_date) WHERE superseded_at IS NULL`;
  - includes PREFLIGHT + VERIFICATION queries and a data-safe rollback note.
- **`src/app/api/ai/daily-plan/route.ts`**: before any provider spend or idempotency claim, resolves the local date and returns the existing canonical plan (`deduplicated: true, adjust_available: true`) if one exists — no second generation/charge. On insert, a `23505` from the unique index (a genuine race) returns the existing canonical plan instead of a 500.
- **`src/lib/today/mutation-guard.ts`** (new): `checkPlanIsToday(supabase, userId, planDate, now)` — resolves stored timezone server-side and classifies via `plan-day.classifyPlanDay`; UTC fallback for invalid/missing tz.
- **`src/app/api/ai/plan-repair/route.ts`** and **`src/app/api/ai/regenerate-section/route.ts`**: reject a mutation whose target plan is not the user's current local day with `409 stale_day` (regenerate also refunds the sample-adjustment claim). Reservations released; no provider spend.
- Manifest migration lists (`manifest.v16.json`, superseded `manifest.v13.json`) updated to enumerate `049` (repo invariant: every manifest lists the complete on-disk set).

## Tests

- `tests/mutation-guard.test.ts` (new, 9 cases): today, midnight rollover with open tab, future date, UTC+14 (Kiritimati), UTC-12, travel (stored tz wins), invalid/missing tz → UTC, malformed plan_date.
- Existing `tests/plan-day.test.ts` (11) still green; manifest/migration contract suites green with `049`.
- Full suite: see commit message for exact counts.

## Boundary cases covered by design

Two tabs / two idempotency keys / duplicate clicks → pre-gen read + unique index → at most one generation. Provider timeout/retry → idempotency ledger unchanged. Midnight during open page / DST / travel / wrong clock → `stale_day` 409 on mutate, `not_today` in guard. Historical/future plan → mutation rejected. Stale version → existing `version_conflict` path. Existing history stays readable (`superseded_at` marks, never deletes).

## Owner actions

- Apply migration `049` to the disposable and production Supabase (preflight → apply → verify queries are in the file). Non-destructive; re-runnable.

## Rollback

Drop `daily_plans_user_date_canonical`; `superseded_at` may remain (harmless). Route/guard changes revert cleanly (no data shape change beyond the additive column).
