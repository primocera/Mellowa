# DB scale, indexes & RLS performance (Launch v6, Prompt 16)

## What changed (migration 025)

- **`claim_ai_generation` is service-role only.** It was executable by any
  authenticated user with a caller-chosen `p_user_id`, per-hour/day limits and
  estimated cost — enough to burn another user's rate limit or spam the global
  daily ceiling. The app now calls it through the admin client.
- New partial indexes: `subscriptions_trial_due_idx` (trial-reminder queue),
  `app_events_user_time_idx` (per-user history/attribution). Migration 024
  already added the reminder-scan and outbox-due indexes.
- **Statement timeouts**: authenticated 5s, anon 3s, service_role 30s. A
  runaway query can no longer hold a pooled connection hostage.
- Privacy export paginates every table read (1000 rows/query) — complete
  output, bounded queries.

## Index coverage of hot paths

Every user-facing query is a `(user_id, date/created_at)` lookup backed by a
composite index from 001/003/004/011/012/013 — see `supabase/checks/rls-audit.sql`
section 6 for ready-to-run EXPLAIN ANALYZE statements. Queue scans
(trial reminders, email outbox, reminder scan) use partial indexes that stay
tiny regardless of table size. No redundant index was removed — none is
provably redundant yet; revisit with pg_stat_user_indexes once there is
traffic.

## RLS / RPC audit

- Static gate: `tests/db-hardening.test.ts` scans every migration — SECURITY
  DEFINER must pin `search_path`; any `p_user_id` function still granted to
  authenticated must check `auth.uid()`; every table must enable RLS.
- Runtime audit: `supabase/checks/rls-audit.sql` (run in the SQL editor;
  every check should return zero rows).
- `claim_generation_request` / `finish_generation_request` keep their
  authenticated grant deliberately — they enforce `auth.uid() = p_user_id`
  in the body.

## Connection pooling

The app talks to Postgres exclusively through PostgREST (supabase-js), which
manages its own pool — Vercel functions never hold direct connections, so
pool exhaustion via the app is structurally impossible. If a direct Postgres
client is ever added, use the transaction pooler (port 6543) and keep
`max_connections` per function at 1. Saturation shows up in Supabase
dashboard → Database → Connections; the free-tier alert threshold is 60.

## Migration checklist (large tables)

1. Idempotent statements (`if not exists`; policies/triggers are the known
   exception — re-runs stop there by design).
2. `create index` on a table that could be large in production →
   plan for `concurrently` (run outside a transaction in the SQL editor).
3. Never rewrite a large table in one statement (no `alter column type` on
   hot tables); add-column-backfill-swap instead.
4. Rollback strategy: additive migrations (all of ours) roll back by simply
   not using the new objects; destructive ones need a written down-script in
   the PR before running.
5. Verify project ref against Vercel's `NEXT_PUBLIC_SUPABASE_URL` **before**
   running anything (lesson learned).

## Honest limits

EXPLAIN ANALYZE at 100k-user synthetic scale and a pgbench load run have NOT
been executed — the free-tier live project is the only database and holds
production data. The index shapes above are the standard access paths for
every query the app makes; validate with section 6 of the audit script as
real data grows.
