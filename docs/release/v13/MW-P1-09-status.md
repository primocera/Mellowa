# MW-P1-09 — Adaptive-day analytics & value scorecard (status: ALREADY IMPLEMENTED)

**No new code required.** The privacy-first analytics loop and the predeclared
capped-cohort scorecard the v13 prompt asks for were built across v8–v12 and are
green at launch/v13. This file records that so the work is not re-commissioned,
and maps the prompt's requested events to the shipped taxonomy.

## Where it lives

- Event taxonomy + funnels: `src/lib/analytics/taxonomy.ts` (allowlisted schema,
  pseudonymous ids, event version, duplicate protection).
- Privacy contract + forbidden-field scan: `tests/analytics-contract.test.ts`
  (fails if `mood`, `allergies`, `journal`, `plan`, `note`, `email`, `name` or any
  free text appears in a payload) and `docs/analytics-events-v8.md`.
- Contract-vs-code lockstep + funnel well-formedness: `tests/value-analytics.test.ts`.
- Predeclared scorecard (cohorts + thresholds + actions): `docs/beta-scorecard.md`;
  funnel-to-decision map + interview scripts: `docs/beta-research.md`;
  freshness gate: `tests/beta-scorecard-contract.test.ts`.

## Requested v13 event → shipped event

| v13 prompt event | Shipped taxonomy event |
| --- | --- |
| sample_started / completed | `sample_plan_requested` / `sample_value_action_completed` |
| onboarding_completed | `onboarding_completed` |
| today_plan_created | `plan_generated` |
| next_step_viewed / engaged / completed | `now_viewed` / `now_action_deferred` / `now_action_done` |
| adjust_initiated / committed / failed | `plan_repair_requested` / `plan_repair_completed` / `plan_repair_failed` |
| undo_used | `plan_repair_undone` |
| low_capacity_selected | `low_capacity` plan property on `plan_generated` |
| second_day_returned | Day-2/Day-3 return metric (check-in on day N / sample completers) |
| weekly_reflection_started / completed | `weekly_reflection_started` / `weekly_reflection_completed` |
| learning_viewed / removed | `personalization_viewed` / `learned_signal_removed` |
| trial_checkout_started | `checkout_started` |
| trial_started / paid_started / canceled | `trial_started` / `trial_converted` (+`checkout_completed`) / `trial_canceled` |

## Derived metrics already defined in the scorecard

Time to first usable plan; share reaching one next step; **adjust commit success**
(`plan_repair_completed`/`_requested`); **undo rate after adjust**; **Day-2 / Day-3
return**; **second changed-day recovery** (derivable: users with
`plan_repair_completed` on more than one distinct day); weekly reflection
completion; learning-transparency interaction; sample→trial and trial→paid
conversion; provider failure rate (`plan_fallback_served`/`plan_repair_failed`);
cancellation reason.

## Predeclared decision rules (already in `docs/beta-scorecard.md`)

Written before data exists: Day-2 return ≥ 40%, Day-3 ≥ 30%, sample adaptation
≥ 35%, weekly opened ≥ 25%, plus **zero tolerance for any safety/billing severity
incident** and a minimum technical success rate. Cohorts separate invited /
sampled / activated / adjusted / returned / trialed / paid / retained; cells under
5 render `—` (no data), never 0%. Staff/test accounts excluded by the migration-039
cap + documented rule.

## Acceptance mapping

| Acceptance criterion | Status |
| --- | --- |
| Team can answer "does Mellowa repeatedly help recover a changed day" | MET — adjust-commit + second-recovery + return metrics + interviews |
| No sensitive content required for the scorecard | MET — forbidden-field scan enforces it |
| Launch decision from behavior + interviews, not vanity traffic | MET — predeclared thresholds + interview scripts |

No taxonomy change was needed for v13; the loop, privacy scan and predeclared
thresholds already satisfy the prompt. Any future addition (e.g. a distinct
`next_step_engaged` event) must extend the allowlist and keep the forbidden-field
scan green.
