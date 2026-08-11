# Recurring-value cohort — metric dictionary (MW-V17-07)

One canonical cohort (`src/lib/analytics/cohort.ts`, `buildCohortScorecard`) feeds
the report (`report.ts` → `MetricsReport.cohort`), the CSV export and the
expansion decision. Every row carries its own `definition`, `maturity` and
`action` in code; this is the human summary. Suppression is MIN_COHORT = 5
distinct people. Nothing is a fabricated zero: immature → `pending`, no source →
`unavailable`.

**Cohort:** activated users = a user's FIRST `checkin_completed`, on its LOCAL
calendar day (per-user IANA timezone from `wellbeing_profiles.timezone`,
DST-correct). Staff/test/demo ids are excluded up front.

| Row | Numerator | Denominator | Maturity | Action |
|---|---|---|---|---|
| `d2_return` | returned (`checkin_completed`) on distinct local day 2 | activated users mature ≥1 day | activation+1 fully elapsed locally | tighten next-action loop before widening intake |
| `d3_return` | returned on distinct local day 3 | activated users mature ≥2 days | activation+2 fully elapsed | same, at day 3 |
| `repair_applied` | `plan_repair_completed` | activated users | any time after activation | low usage ⇒ Adjust entry point problem |
| `repair_undone` | `plan_repair_undone` | activated users | — | Undo is free; high undo = unwanted reshape, not a paywall |
| `repeat_repair_distinct_day` | repairs on ≥2 distinct local days | activated users | ≥2 distinct days | **core repeat-value proof; must mature before public-paid** |
| `week_opened` | `weekly_reflection_started` | activated users | reached a first week | opened ≠ completed |
| `week_closeout_completed` | `weekly_reflection_completed` | activated users | finished a first week | week-continuity gate |
| `carry_forward_accepted` | `carry_forward_saved` | completed closeouts | second-week maturity | strongest continuity signal |
| `trial_converted` | `trial_converted` | activated users | trial decision reached | gates public-paid, never above live-money |
| `first_renewal` | `subscription_renewed` among eligible | payers whose `current_period_end` passed | period end passed (else pending) | must be mature (not pending) for 9.5 |
| `refund` | `payment_refunded` | converted | any in window | above threshold ⇒ NO-GO |
| `dispute` | `payment_disputed` | converted | any in window | any open dispute ⇒ NO-GO |
| `support_burden` | **UNAVAILABLE** | — | no privacy-safe ticket system yet | stand up an admin-only aggregate `ticket_category` counter (no message content) first |

**Privacy:** rows carry only counts/ids-derived aggregates — no mood, stress,
allergy, journal, plan content, email or free text ever enters a property, export
or log. **No `plan_repair_previewed` metric exists** — the product renders no
reversible preview before apply, so preview→apply is deliberately not reported.

**Expansion:** fails closed on missing/stale analytics, any under-five cell, an
incomplete observation window, any dispute, or any open billing/safety P0/P1.
Synthetic examples are NOT customer evidence.
