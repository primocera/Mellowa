# Weekly paid-value memo — SYNTHETIC EXAMPLE (NOT REAL DATA)

> ⚠️ **NOT REAL DATA.** Every number below is invented to show the shape of a
> filled-in memo. It reflects no real Mellowa user, cohort, or revenue. Do not
> cite it, publish it, or treat it as evidence of anything.

Filled-in example of `WEEKLY-PAID-VALUE-MEMO.md` for one hypothetical beta week.

## Week context

- Window: 2026-07-13 → 2026-08-09 (four-week rolling)
- `dataFreshness.stale`: no (last event 3h ago)
- Cohort size (active accounts): 41
- Running experiment: `trial_len_v1` / conflicts: none

## The three paid jobs — do they recur?

| Paid job | Canonical signal | This week (num / denom / state) | Reads as |
|---|---|---|---|
| **Adapt today** | `plan_repair_completed` | 14 / 38 / meets_hypothesis | used the adapt-the-day wedge |
| **Reuse what works** | `favourite_reused` + `preset_applied` | 9 / 38 / no_data* | reused a saved choice |
| **Carry into next week** | `next_week_plan_created` | 6 / 12 / below_hypothesis | carried decisions forward |

\* Combined reuse denominator sits just under MIN_COHORT for the distinct-signal
split, so it renders **no data**, not 24%.

Recurring Adjust on distinct local days / D2·D3: **owner-observed, not yet
automated** (MW-95-03 follow-up).

## Money (synthetic)

| Metric | Value |
|---|---|
| sample → trial | 27% |
| trial → charge | 31% |
| first renewal | below hypothesis (0.42 vs 0.50), cohort still immature |
| refund / dispute | 1 refund, 0 disputes |
| AI cost per retained payer | $2.10 |
| MRR by currency | USD 214.00; EUR 92.00 (not summed) |
| support contacts per active account | 0.15 (owner-entered) |

## The one expansion question

`canExpand` = **false** — "Return meets the hypothesis, but the renewal cohort is
immature; the four-week renewal window is not complete."

## Which hard scale-stops are active in this synthetic week

- #4 first renewal below its predeclared hypothesis on a not-yet-mature cohort →
  **hold**, read again when the window matures.
- #7 recurring-Adjust distinct-day evidence not yet automated → **hold** on any
  claim that Adjust recurrence justifies renewal.

Everything else is clear in this invented example, but two holds are enough:
expansion stays **NO**, public-paid readiness stays **below 9.5**.
