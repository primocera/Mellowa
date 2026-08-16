# XAPP-03 — Controlled beta operation and evidence-based expansion (Mellowa)

**Outcome:** Acquisition expands only after repeat value and operational safety mature.
**Verdict:** completed (operating system consolidated). Weekly decisions are owner-run.

## Bounded launch operating system

| Parameter | Value | Enforced by |
|---|---|---|
| Cohort cap | **50 accounts** | DB trigger, migration `039` (fails **open** so a missing settings row never locks everyone out) |
| Target ICP | Busy women 25–45, inconsistent routines, gentle daily structure — no medical/ED need | Signup consent + safety classification |
| Invitation source | Owner-curated invites (≤ cap) | Beta intake switch |
| Staff/test/demo exclusion | Server-owned exclusion registry (migration 045) | `readExclusionRegistry` |
| Observation window | **≥ 4 weeks** before any expansion decision | `docs/beta-scorecard.md` |
| Support owner | Solo operator, monitored daily | `docs/support-runbook.md` |
| Emergency pause | Close intake / disable generation (reversible; deletes nothing) | Beta capacity switch |

Mellowa's Supabase, analytics and Stripe ownership stay isolated from Scalvya
(XAPP-01). Each app has its own repeat-value proof; neither shares a cohort.

## Mellowa expansion thresholds (predeclared, fixed before data — MW-10)

D2 ≥ 40%, D3 ≥ 30%, Week closeout ≥ 25% of eligible second-week users,
carry-forward ≥ 50% of closeouts, trial-to-charge ≥ 40%, first renewal ≥ 70%,
refunds ≤ 5%, **any dispute is a stop**, plus mature repeat-repair evidence
(`repeat_repair_distinct_day`) and support burden within the ceiling. Pending /
suppressed / unavailable all mean *wait*, never *zero*.

## Weekly operator decision

Generated from the canonical report (`buildMetricsReport` → admin + CSV): exact
numerators/denominators, maturity, data watermark, incidents, support categories
(privacy-safe), costs, interview signal. **Allowed decisions:** stop, pause intake,
interview, iterate one variable, continue bounded, expand.

**Expand is blocked** (canonical decision engine, `expansionVerdict`) whenever any
required metric is **unavailable, immature, breached**, or an owner gate is
incomplete. v19 adds two more blocks that feed the same "wait" logic:
- **Pricing discovery** (`report.pricingDiscovery.canRecommendPriceChange = false`)
  while any required cohort is immature or a refund/dispute/support risk is present.
- **Scale readiness** (`report.observability.scaleReady = false`) while any critical
  SLO is breached/unavailable, a budget is over, or capacity is unmeasured.

No acquisition increase is justified by signups, page views or generation count
alone. Thresholds are versioned and fixed before data. The owner can pause
signup/generation without taking editing/history/export offline.

## Current expand state

**BLOCKED** — the beta has no mature 4-week window yet; observability is largely
unavailable (SLIs not fully instrumented) and pricing discovery is closed on
immature cohorts. This is the correct default until real bounded-cohort data
matures. See FINAL-01 for the tier verdicts.
