# MW-10 — Resolve the repair-preview metric contradiction

**Outcome:** Every active threshold has an executable numerator and denominator.
**Verdict:** completed (docs + enforcement test). No code change needed.

## The decision (from real product behavior)

The Adjust sheet is an **input form**, not a reversible preview. `plan-repair`
generates one atomic repair, commits it in a single transaction
(`apply_plan_repair`), the UI then shows a **deterministic post-commit diff**, and
Undo is free (`undo_plan_repair`). This is MW-10's **Path B** — the production code
(`src/lib/analytics/cohort.ts`) and the v17 cohort dictionary already implement it:
the emitted events are `plan_repair_requested`, `plan_repair_completed`,
`plan_repair_undone` (+ `repeat_repair_distinct_day`). **No `plan_repair_previewed`
event exists.**

## The contradiction

The active `docs/beta-scorecard.md` still listed `plan_repair_previewed` and a
`preview→apply` metric — an event/denominator with no executable source. v16's own
`GAP-REGISTER.md` (MW-95-03) had already flagged this as an open defect.

## Changes (docs only)

- **`docs/beta-scorecard.md`**: replaced the two preview rows with the real funnel —
  "Adjust used" (`plan_repair_requested` / accounts with ≥2 plans, ≥30%), "Adjust
  applied" (`plan_repair_completed / plan_repair_requested`, ≥50%), "Repeat repair
  on distinct days" (`repeat_repair_distinct_day`, observed), "Undo used"
  (`plan_repair_undone`, observed). Added a note explaining there is no
  before-commit preview (atomic commit + deterministic diff + free Undo).
- **`docs/release/v16/READINESS-SCORE.md`**: the predeclared 9.5 hypothesis
  "repair preview→apply ≥ 50% of previews" corrected to "repair applied ≥ 50% of
  `plan_repair_requested`" — **same 50% target**, executable denominator, no
  preview event. (A definitional fix of a metric that had no source, not a
  threshold move after seeing data.)
- **`docs/release/v16/GAP-REGISTER.md`**: MW-95-03 marked preview-metric RESOLVED
  (v19 MW-10), noting `onboarding_completed` was already made server-authoritative in v17.

## Protected thresholds unchanged

D2 ≥ 40%, D3 ≥ 30%, Week closeout ≥ 25%, carry-forward ≥ 50%, trial→charge ≥ 40%,
first renewal ≥ 70%, refund ≤ 5%, any-dispute-stop — all untouched.

## Tests

- `tests/repair-metric-truth.test.ts` (new): no active scorecard/readiness doc
  uses `plan_repair_previewed` as a metric or a `preview→apply ≥` threshold; the
  code (catalog + repair route) never emits `plan_repair_previewed`; the real
  repair events exist in the catalog; the active scorecard names the real funnel.
- Existing `cohort-scorecard.test.ts` (already Path B: apply/undo/distinct-day, no
  preview) and `beta-scorecard-contract.test.ts` unchanged and green.

## Rollback

Revert the doc edits + the new test.
