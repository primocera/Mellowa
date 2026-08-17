-- MW-07 (v20): durable support-ingestion coverage.
--
-- The support ledger (047) is privacy-safe and correctly reports UNAVAILABLE
-- when nothing has been ingested, but "verified" ingestion depended on a single
-- operator env flag (SUPPORT_INGESTION_VERIFIED). This table makes ingestion
-- coverage DURABLE and auditable: each import records its source, counts and the
-- coverage window it claims. Readiness/burden then derive `verified` from real
-- recent evidence — a current successful import — not an env flag alone.
--
-- Privacy: metadata ONLY. It stores counts, a coverage window, a source label
-- and the admin actor id (audit). No ticket body, subject, email, address or
-- wellbeing content — those never exist in the support subsystem at all.

create table if not exists public.support_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,               -- 'manual_csv' | 'manual_json' | provider
  imported_count integer not null default 0,
  updated_count integer not null default 0,
  rejected_count integer not null default 0,
  coverage_start date,                -- inclusive window the operator reviewed
  coverage_end date,                  -- inclusive; drives staleness
  actor_user_id uuid,                 -- admin who ran the import (audit only)
  created_at timestamptz not null default now()
);

create index if not exists support_ingestion_runs_recent_idx
  on public.support_ingestion_runs (created_at desc);
create index if not exists support_ingestion_runs_coverage_idx
  on public.support_ingestion_runs (coverage_end desc);

alter table public.support_ingestion_runs enable row level security;
-- No policies: only the service role (admin import route, burden reader) touches it.

-- VERIFICATION:
--   select source, imported_count, coverage_start, coverage_end, created_at
--     from public.support_ingestion_runs order by created_at desc limit 5;
--
-- Rollback (data-safe):
--   drop table if exists public.support_ingestion_runs;
