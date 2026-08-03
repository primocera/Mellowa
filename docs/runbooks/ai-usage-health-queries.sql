-- MW-P1-10 — AI usage ledger health queries
--
-- Run in the Supabase SQL Editor against the production project. These surface
-- the failure MW-P0-01 hardened against: a `claim_ai_generation` row that was
-- reserved but never finalized or released, which distorts quota, cost and the
-- global daily ceiling and can eventually starve generation.
--
-- Read from the LEDGER, never from a user's content. Anonymise before pasting
-- into release evidence: no user emails, last 4 chars of ids only, no prompts,
-- journal text or reflections (the ledger never stores them anyway).

-- ---------------------------------------------------------------------------
-- 1 · Stuck reserved usage. A row that has sat 'reserved' beyond the longest
--     possible provider timeout (60s call + one bounded retry) is orphaned.
--     Expected result: ZERO rows. Any row here is an alertable defect.
-- ---------------------------------------------------------------------------
select id, route, status, created_at,
       now() - created_at as age
from public.ai_usage_events
where status = 'reserved'
  and created_at < now() - interval '5 minutes'
order by created_at asc;

-- ---------------------------------------------------------------------------
-- 2 · Reserved-vs-terminal ratio in the last 24h, by route. A healthy route
--     finalizes/releases essentially everything it reserves. journal-reflection
--     must show ~0 lingering 'reserved' after MW-P0-01.
-- ---------------------------------------------------------------------------
select route,
       count(*) filter (where status = 'reserved') as still_reserved,
       count(*) filter (where status <> 'reserved') as terminal,
       count(*) as total
from public.ai_usage_events
where created_at > now() - interval '24 hours'
group by route
order by still_reserved desc, total desc;

-- ---------------------------------------------------------------------------
-- 3 · Journal-reflection safety outcomes (last 7 days). Tracks how often the
--     output guard fired: 'safety_blocked' is the MW-P0-01 fail-closed terminal
--     status (both attempts unsafe). A sudden spike is a prompt/model
--     regression to investigate — never the content, only the counts.
-- ---------------------------------------------------------------------------
select status,
       count(*) as n,
       round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1) as pct
from public.ai_usage_events
where route = 'journal-reflection'
  and created_at > now() - interval '7 days'
group by status
order by n desc;

-- ---------------------------------------------------------------------------
-- 4 · Finalize failures proxy: rows whose terminal status implies a provider
--     charge (tokens present) but that never advanced past 'reserved' — should
--     be empty; pairs with the app-log line "[ai] finalize_ai_usage failed".
-- ---------------------------------------------------------------------------
select id, route, status, created_at
from public.ai_usage_events
where status = 'reserved'
  and created_at < now() - interval '15 minutes'
order by created_at asc;
