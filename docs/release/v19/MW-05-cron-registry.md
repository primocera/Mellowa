# MW-05 — Durable account deletion and all external cron workers

**Outcome:** Deletion, retention and retry work continue after the request and survive failure.
**Verdict:** completed (registry + docs + tests; freshness via MW-04). Live pinger setup is an owner action.

## What already existed (not re-done)

The durable account-deletion path is implemented and tested:
- `src/lib/account-deletion/{machine,worker,receipt}.ts` — resumable state machine:
  verify exact Mellowa Stripe ownership → cancel owned subscription → clear registry
  data → delete auth identity → verify absence → minimize job → queue receipt only
  after completion. A crash leaves the row at its last completed milestone with
  `last_error_code` + `next_attempt_at`; an expired 5-min lease (`worker_leased_until`)
  re-claims it; no permanent-failed terminal, so no partial deletion sends a false
  completion. Covered by `tests/account-deletion-machine.test.ts` and the cron/receipt tests.
- Email outbox worker (migration 021, `claim_due_emails` SKIP LOCKED lease).

## The gap MW-05 closes

There was **no machine-readable job registry**, and two job routes
(`account-deletion`, `billing-reconcile`) had **no schedule documentation**.

## Changes

- **`src/lib/ops/cron-registry.ts`** (new): the single typed registry of all six
  jobs — route, method, auth secret **name**, schedule (source + cadence + cron),
  owner, timeout, batch size, lease mechanism + minutes, last-success expectation,
  alert threshold and runbook anchor. Stores env-var names only, never a value.
- **`docs/ops-cron.md`**: added a "Background job registry (MW-05)" section (table
  of all six jobs) plus worker sections for account-deletion, retention and
  billing-reconcile, an owner schedule-verification note, and updated the readiness
  description to reflect MW-04 (044–049 + worker freshness).
- Worker freshness signals (`deletion_worker_freshness`, `outbox_freshness`) are
  surfaced by `/api/health/ready` (built in MW-04) — the freshness signal per
  critical job that MW-05 asks for.

## Tests

- `tests/cron-registry-contract.test.ts` (new, 7): every `src/app/api/cron/*`
  route has exactly one registry entry and vice-versa; every Vercel-source entry
  matches `vercel.json` (path + cron) and every `vercel.json` cron is a
  Vercel-source entry; every entry has secret/cadence/lease/alert/runbook/owner;
  the registry contains no secret value (env-var names only); `docs/ops-cron.md`
  documents every registered route.
- Existing deletion machine/cron/receipt suites unchanged and green.

## Owner actions (not automatable)

- Configure the external pinger (e.g. cron-job.org) for the four non-Vercel jobs
  (`email-outbox`, `account-deletion`, `retention`, `billing-reconcile`) with
  `Authorization: Bearer <CRON_SECRET>` at the cadence in the registry; verify each
  returns `200` (401 = wrong secret, 503 = unset).
- Watch `/api/health/ready` `deletion_worker_freshness` / `outbox_freshness`.

## Rollback

Delete the registry + its test and revert the ops-cron.md section; no runtime behavior change (the registry is documentation/verification, not a code path).
