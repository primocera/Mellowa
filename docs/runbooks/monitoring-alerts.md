# Monitoring & alerts — Mellowa (MW-V9-10)

Operational signals to watch before and during acquisition scale-up. Thresholds
are starting points; tune from observed data. All metrics are aggregate/internal
— no customer content.

## Fair-use policy (published safeguard, not a hidden throttle)

Premium is "ongoing daily plans with **fair-use safeguards**", never "unlimited".
Layered limits (all in `src/lib/ai/rate-limit.ts` + `src/lib/ai/fair-use.ts`):

| Limit | Value | Enforced by | Rollback |
|---|---|---|---|
| Per-hour generations | 15 | `claim_ai_generation` RPC | code |
| Per-day generations | 40 | `claim_ai_generation` RPC | code |
| Per-user trailing-30-day | 300 (`AI_MONTHLY_GENERATION_CAP`) | migration 035 overload | `FLAG_MONTHLY_FAIR_USE=0` |
| Global daily spend ceiling | $5 (`AI_GLOBAL_DAILY_CEILING_USD`) | `claim_ai_generation` RPC | env |

The monthly cap (300) sits far above heavy use (~90/month) and only bites
runaway/abusive use. When a user reaches it they get an honest message stating
what remains available and that they can create new plans again soon — never an
upsell, never a silent throttle.

### Synthetic monthly cost (assumptions in `USAGE_MIXES`)

`syntheticMonthlyCostUsd(mix)` estimates per-user AI cost including the safety
classification before every daily plan and the one bounded retry. Run the admin
scorecard's p50/p90 + high-use count against these to see whether real retained
usage stays inside the current subscription economics — the catalog in
`src/lib/stripe/plans.ts` (USD-first $12.99/mo · $129.99/yr; EU/EEA €11.99/mo ·
€119.99/yr) — before changing or promoting pricing. **Do not change the catalog
prices without four-week evidence + owner sign-off.**

## Alert set (owner-configured; Claude Code does not wire live alerting)

| Signal | Source | Alert when |
|---|---|---|
| Global spend ceiling | `ai_usage_events` daily sum vs `globalDailyCeilingUsd()` | daily spend ≥ 80% of ceiling |
| Provider error / latency | `ai_usage_events.status`, `latency_ms` | error rate spikes or p90 latency regresses |
| Repair failure rate | `plan_repair_failed` / `plan_repair_requested` | > 30% over a day |
| Fallback rate | `generationHealth.fallbackRate` | sustained rise |
| Webhook / reconcile errors | `stripe_events.status='failed'`, `reconcile()` MISMATCH | any mismatch or failed event backlog |
| Email outbox / dead-letters | outbox table backlog | dead-letter growth |
| Cron health | pinger heartbeats | a scheduled job misses its window |

## Stuck AI usage reservations (MW-P1-10 / ties to MW-P0-01)

Every AI route reserves a `claim_ai_generation` row and MUST finalize or release
it on every terminal path. MW-P0-01 completed this for journal-reflection. Watch
for orphans with `docs/runbooks/ai-usage-health-queries.sql`:

| Signal | Query | Alert when | Owner action |
|---|---|---|---|
| Stuck reserved usage | query 1 | any row `reserved` > 5 min | investigate the route's finalize/finally path; the row inflates quota/ceiling |
| Reserved-vs-terminal ratio | query 2 | any route with a non-trivial `still_reserved` in 24h | a route is leaking reservations |
| Journal safety-block rate | query 3 | `safety_blocked` share spikes vs baseline | prompt/model regression — inspect counts, never content |
| Finalize failure | query 4 + app log `[ai] finalize_ai_usage failed` | any lingering row | ledger write is failing; check admin RPC / DB |

Alerts use redacted identifiers only — never journal, plan, prompt or reflection
text. Escalation: owner, same-day; a rising stuck-reservation trend is a launch
stop condition for the affected route.

## Owner-run drills (scripted, not executed by Claude)

- Reminder duplicate-eligibility + forced provider failure: worksheet in
  `docs/ops-cron.md`, queries in `docs/runbooks/reminder-rehearsal-queries.sql`
  (dedupe **key** isolation; transient → retry/backoff → success; permanent →
  dead-letter → recovery). Use a test recipient; never real customer reminders.
- Isolated backup restore with measured RTO/RPO: `docs/runbooks/restore-verification.sql`
  against a non-production target; never overwrite production.
- Per-secret key rotation with overlap + validation + rollback:
  `docs/runbooks/key-rotation-and-backup.md` + `scripts/secret-fingerprint.mjs`
  (identity check, never prints a value). Gated by `tests/resilience-beta.test.ts`.
  **Do not rotate keys except in an owner-approved operation.** Tested RTO/RPO stay
  blank (P1-ROTATION-RESTORE accepted risk) until the owner runs the drill.

## Known follow-up

- **Ceiling-denial counting**: a denied claim writes no ledger row, so
  `usage.ceilingDenials` is currently 0. p50/p90 + high-use already flag
  unsustainable use; add explicit denial logging if denial trend visibility is
  needed. Tracked here rather than adding a write to the generation hot path now.
