# MW-13 — Operational SLOs, performance budgets, cost and 10x capacity

**Outcome:** Scale readiness uses observed field data rather than catalog constants.
**Verdict:** completed (evaluators wired to live telemetry + honest unavailable gating). Full instrumentation of every SLI is an owner follow-up.

## Before

`src/lib/observability/slo.ts` (SLO catalog + evaluators) and `src/lib/perf/budget.ts`
(perf/cost budgets + `capacityAt10x`) were test-only — no production caller.

## Change

- **`src/lib/observability/report.ts`** (new): `buildObservability({observedSlos,
  observedBudgets, capacity})` runs `evaluateAll` + `evaluateBudgets` +
  `capacityAt10x` and returns a **scale-readiness verdict**. Every SLO journey is
  critical: a **breached or unavailable** SLO, an **over** budget, or **unmeasured
  capacity** sets `scaleReady=false` and is named in `blockingReasons` (with the
  SLO owner). An unavailable/unmeasured signal is never a silent pass.
- **`src/lib/analytics/report.ts`**: computes observed values from live telemetry
  where it exists — `ai_cost_per_activated` from `unitEconomics().aiCostUsd /
  activated users`, `deletion_stuck` from the read-only `account_deletion_stats`
  RPC — and passes `null` for the not-yet-instrumented SLIs (auth/persistence/
  latency/CWV/webhook) so they read UNAVAILABLE. Capacity is `null` (provider
  ceiling not load-tested → unavailable). Added `observability` to `MetricsReport`
  + CSV (`slo_*`, `budget_*`, `observability` rows).
- **`src/app/admin/page.tsx`**: a "Scale readiness (SLOs & budgets)" card — scale
  ready?, capacity state, and blocking reasons.

## Honest current state

Because most SLIs are not yet instrumented with a single-query source, the live
verdict is **scaleReady = false** with the unmeasured journeys and capacity named.
That is the correct, non-fabricated reading — MW-13 requires unavailable to be
surfaced and to block scale, not hidden as a green.

## Tests

- `tests/observability-report.test.ts` (new, 8): all-clear → ready; a breached
  critical SLO / an unavailable SLI / an over budget / unmeasured capacity / a 10x
  projection over ceiling each block scale and are named; the report wires
  `buildObservability` to `aiCostPerActivated` + `account_deletion_stats`; admin
  surfaces scale readiness.
- Existing `observability` / `perf-budget` evaluator suites unchanged and green.

## Owner follow-ups (named, not faked)

- Instrument the remaining SLIs with redacted structured events (auth, persistence,
  generation latency, webhook, entitlement) and CWV field p75 for landing/today.
- Load-test peak concurrent generations to set the provider ceiling → capacity.

## Rollback

Revert the report/admin wiring + delete `observability/report.ts` and its test;
the pure evaluators are unchanged.
