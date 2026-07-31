-- MW-V12-07: privacy-safe real-user Web Vitals.
--
-- Field performance the warm lab suite cannot see. Deliberately ANONYMOUS:
-- there is no user_id, no anon_id, no IP — a row is a metric, its rating, the
-- app route, a coarse device class and the build id. Nothing here can identify
-- a person or carry wellbeing content, so it is not user-owned data and is
-- exempt from the export/deletion registry by construction (no user column).
--
-- Written only by the service role via /api/vitals. RLS is on with NO policies,
-- so anon/authenticated clients can neither read nor write directly; the
-- service role bypasses RLS for the ingest insert. Read is owner-only through
-- the admin surface. Additive and re-runnable.
create table if not exists public.web_vitals (
  id uuid primary key default gen_random_uuid(),
  metric text not null check (metric in ('LCP','CLS','INP','FCP','TTFB')),
  rating text not null check (rating in ('good','needs-improvement','poor')),
  -- Bucketed value (privacy): ms for timing metrics, hundredths for CLS.
  value numeric not null,
  route text not null,
  device_class text not null check (device_class in ('phone','tablet','desktop')),
  build_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists web_vitals_metric_created_idx
  on public.web_vitals (metric, created_at desc);
create index if not exists web_vitals_route_idx
  on public.web_vitals (route);

alter table public.web_vitals enable row level security;
-- No policies on purpose: only the service-role ingest writes, only the admin
-- surface reads. A missing policy fails closed for every normal client.
