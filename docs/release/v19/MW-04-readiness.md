# MW-04 — Deep readiness covers migrations 044–049 and critical workers

**Outcome:** Readiness cannot be green while a new v18/v19 subsystem is absent or stale.
**Verdict:** completed (code + tests). Live post-deploy checks are owner actions.

## Before

`GET /api/health/ready` (private, `ADMIN_STATS_SECRET`) only probed legacy
migrations **020/021**, the two v9 RPC overloads and config presence. A production
database missing any 044–048 object — account deletion, cohort facts, onboarding
provenance, support tickets, activation view — could still report ready. There
was no worker-freshness signal, and only `ok/fail/not_configured` statuses.

## Change

- **`src/lib/health.ts`**:
  - `ComponentStatus` now `ok | degraded | fail | not_configured | unavailable`.
  - `summarizeReadiness(components, { mode, critical })`: `fail` always blocks;
    in **paid** mode a `degraded`/`unavailable` **critical** component blocks
    (closed), in **beta** it is warn-only; `not_configured` never blocks. No-args
    call keeps the original behaviour (backward compatible).
  - `classifyWorkerFreshness({ stuckOrDead, oldestDueMs, maxDueAgeMs })` — pure,
    counts only; `readinessMode(env)` (defaults to `beta`, only `paid` opts in).
- **`src/app/api/health/ready/route.ts`**: added side-effect-free presence probes
  for migrations **044** (`account_deletion_requests`), **045**
  (`analytics_excluded_users`), **046** (`onboarding_completions.source`), **047**
  (`support_tickets`), **048** (`analytics_activation_facts` view) and **049**
  (`daily_plans.superseded_at`); a signature+freshness probe via the read-only
  `account_deletion_stats(3)` RPC (`deletion_worker_freshness`); and outbox
  freshness from `email_deliveries` (dead-letter count + oldest due →
  `outbox_freshness`). All migration + worker components are marked `CRITICAL`;
  the verdict uses `readinessMode()` so paid fails closed with 503.

Output remains operator-safe: counts, ids of a marker column and timestamps only —
never a secret, address, error detail or user content.

## Tests

- `tests/health.test.ts` (+ MW-04 blocks): beta-vs-paid (fail blocks both;
  degraded/unavailable critical warn-only in beta, closed in paid; not_configured
  and non-critical degraded never block; mode echo; `readinessMode` default),
  and `classifyWorkerFreshness` (ok / stuck→degraded / stale→degraded).
- `tests/readiness-migrations-contract.test.ts` (new): a probe + named component
  per migration 044–049, the deletion-stats RPC + freshness wiring, CRITICAL +
  paid-closed summarize call, and an operator-safety assertion (no email/content
  column selected). This is the required readiness contract test per new migration.
- Existing `health`/`readiness-route` (public pricing) suites unaffected.

## Owner actions (post-deploy live checks — not automatable)

After deploying a candidate SHA, with production env + `SUPABASE_SERVICE_ROLE_KEY`
+ `ADMIN_STATS_SECRET`:

1. `GET /api/health` → expect `200` (liveness).
2. `GET /api/health/ready` with `Authorization: Bearer $ADMIN_STATS_SECRET` →
   expect `200`; every `migration_04x`/`migration_049` component `ok`, both RPC
   overloads `ok`, `deletion_worker_freshness`/`outbox_freshness` `ok`. A `503`
   names the failing/degraded component — do not launch paid until resolved.
3. For a **paid** launch set `READINESS_MODE=paid` in production so a degraded or
   unavailable critical worker fails closed. Beta may run with the default (warn-only).

`version` in the response is the deployment's short SHA — record it with the check.
Migration `049` must be applied first (see MW-02).

## Rollback

Revert the route/health changes; the additive migrations are unaffected. `summarizeReadiness` without options restores the prior fail-only verdict.
