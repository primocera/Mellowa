# Performance — lab, warm, cold and field (MW-V12-07)

Four different measurements, never conflated. A number is only as good as the
label next to it.

| Signal | What it is | Where | Gate? |
|---|---|---|---|
| **Lab (warm)** | Warm-server, cold-cache load, 4× CPU / ~Slow 4G, one machine | `npm run perf` → `docs/release/evidence/v11/perf/vitals.json` | **Yes** — release gate |
| **Lab (cold)** | Same, but no warm-up: server start-up is included | `PERF_MODE=cold … npm run perf` → `perf/vitals-cold.json` | No — advisory |
| **Field** | Real users' LCP / CLS / INP, anonymous | `web_vitals` table via `/api/vitals` | No — informs launch claims once it has enough data |

## What may be claimed, and when

- The **warm lab** numbers may be stated as "lab, warm-server" with the exact
  conditions. They are not a field claim and must never be called p75.
- **Cold-start** is stated separately: "cold-start LCP measured ~X on a deployed
  preview". One cold run is advisory; do not fail a release on a single noisy
  cold number.
- A **field** claim requires at least **100 samples** for the metric+route and
  must be reported as the **75th percentile** (`FIELD_PERCENTILE`), never a mean
  and never a raw value. Below that sample count, report "insufficient field
  data", never a percentage. These thresholds live in
  `src/lib/perf/web-vitals.ts` so the doc and the code cannot drift.

## Cold-start measurement (owner-run, against a deployed preview)

A local `next start` has no serverless cold start, so cold must be measured
against a real preview:

```
# Deploy a preview, then point the perf project at it and run cold:
E2E_BASE_URL=https://<preview-deployment> PERF_MODE=cold npm run perf
# Artifact: docs/release/evidence/v11/perf/vitals-cold.json (mode: "cold")
```

## Field collection — what is and is not collected

Collected per sample: `metric` (LCP/CLS/INP/FCP/TTFB), server-recomputed
`rating`, a **bucketed** `value`, the app `route` (pathname with id-shaped
segments collapsed), a coarse `device_class` (phone/tablet/desktop) and the
`build_id` (deploy commit, truncated).

**Never collected:** user id, anon id, IP, session, query strings, check-in
text, wellbeing data, plan content or email. The ingest (`/api/vitals`) never
reads the session and recomputes the rating and route server-side, so a client
cannot forge a flattering value or smuggle a payload. The `web_vitals` table has
no user column and RLS-with-no-policies, so only the service-role ingest writes
and only the admin surface reads.

## Release workflow

The warm lab suite is the performance gate at the candidate SHA. Cold and field
are recorded and read as separate signals; neither is a single-run gate, so a
flaky cold measurement cannot block a candidate on its own. Accessibility,
no-JS-visible content where intended, and reduced-motion behaviour are unchanged
by field collection — the collector renders nothing and only observes.
