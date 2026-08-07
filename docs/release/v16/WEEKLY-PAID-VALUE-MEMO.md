# Weekly paid-value memo — blank template (MW-95-06)

One repeatable weekly read of whether Mellowa's **three paid jobs** recur often
enough to justify payment. Every cell is filled from the canonical metrics report
(`src/lib/analytics/report.ts` → `buildMetricsReport`), never re-derived by hand,
so this memo and the admin dashboard cannot disagree. Language is **use / return
/ completion** — never adherence, recovery, improvement or "better health".

> This is a decision view, not a claim. A green week here is not proof people
> will pay; it is evidence to weigh against the predeclared hypotheses. On its
> own it leaves public-paid readiness **below 9.5** — the owner billing/auth
> gates and a mature renewal window gate that (see the hard scale-stops below).

## Week context

- Window: `______` (start → end, four-week rolling recommended)
- `dataFreshness.stale`: `______` (if stale → **stop**, read nothing below)
- Cohort size (active accounts): `______` (cells under MIN_COHORT render "no data", never 0%)
- Running experiment (one at a time): `______` / conflicts: `report.experimentConflicts`

## The three paid jobs — do they recur?

| Paid job | Canonical signal | This week (num / denom / state) | Reads as |
|---|---|---|---|
| **Adapt today** | `loop` step `plan_repair_completed` (+ recurring Adjust on distinct days*) | `___ / ___ / ___` | used the adapt-the-day wedge |
| **Reuse what works** | `favourite_reused` / `preset_applied` / `shopping_draft_built` | `___ / ___ / ___` | reused a saved choice |
| **Carry into next week** | `loop` step `next_week_plan_created` (Week → carry-forward) | `___ / ___ / ___` | carried decisions forward |

\* Recurring Adjust on **distinct local days** and D2/D3 return are the cohort-math
metrics deferred from MW-95-03; until they are computed, record them as **owner-observed /
not yet automated**, not as 0.

## Money (server/webhook-authoritative, deduped)

| Metric | Source field | Value |
|---|---|---|
| sample → trial | `report.sampleToTrial.rate` | `___` |
| trial → charge (paid) | `report.trialToPaid.rate` | `___` |
| first renewal | `loop` step `subscription_renewed` | `___` |
| refund / dispute | `report.churn` / `billing_health` funnel | `___` |
| AI cost per retained payer | `report.costPerOutcome.perRetainedPayerUsd` (USD; null = unknown) | `___` |
| MRR by currency (never summed w/o FX) | `report.economics.mrrByCurrency` | `___` |
| support contacts per active account | privacy-safe support aggregate (owner-entered; MW-95-03 follow-up) | `___` |

## The one expansion question

`report.expansion.canExpand` = `___` — reason: `report.expansion.reason`.

## Hard scale-stops (any one halts expansion)

Stop and do **not** widen intake / spend on acquisition if any hold:

1. **Any** dispute (`payment_disputed` > 0).
2. An unexpected charge or trial-eligibility mismatch.
3. Any safety / allergen / privacy incident.
4. First renewal **below** its predeclared hypothesis on a **mature** cohort.
5. Refund rate **> 5%**.
6. Unsustainable cost per retained payer or support load.
7. Weak **D2/D3** or recurring-**Adjust** evidence (once those are computed).
8. `dataFreshness.stale` or any required cell under MIN_COHORT.

None of these is fixed by a notification, streak, reward or a new generator — the
decisions above are product judgements, not growth nudges.

## What may eventually be published as proof

Only a **consented, verified, non-health** statement, shown **with denominator,
date and context**. Never an inferred testimonial; never a small-cohort
percentage presented as broad proof; never before the evidence and the explicit
consent both exist. Every public-proof candidate needs manual review.
