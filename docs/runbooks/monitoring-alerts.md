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
usage stays inside the €59.99/yr (~€5/mo) economics before changing or promoting
pricing. **Do not change €9.99/€59.99 without four-week evidence + owner sign-off.**

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

## Known follow-up

- **Ceiling-denial counting**: a denied claim writes no ledger row, so
  `usage.ceilingDenials` is currently 0. p50/p90 + high-use already flag
  unsustainable use; add explicit denial logging if denial trend visibility is
  needed. Tracked here rather than adding a write to the generation hot path now.
