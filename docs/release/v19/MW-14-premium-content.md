# MW-14 — Final premium product, safety, content and continuity pass

**Outcome:** Mellowa feels worth paying for because it adapts a real day and carries value forward.
**Verdict:** completed at the unit/content-contract level; browser-level assertions are owner-run E2E.

## State found

The content/safety surface is already guarded by 18 contract suites
(`content-audit`, `commercial-copy`, `safety`, `safety-matrix`, `today-copy`,
`week-copy`, `you-copy`, `billing-copy`, `onboarding-copy`, `funnel-copy`,
`ai-safety-contract`, …). A scan confirmed **no banned claims** and **no
"DailyFlow"** in customer copy, and the safety redirects/allergen handling are
intact. No scope creep (no calorie tracking, streaks, social feeds, medical advice)
was introduced anywhere in v19.

## Verified / preserved

- **Three paid jobs** are each expressed in customer copy — adapt today
  (Adjust + free Undo), reuse what works (favourites/leftovers/"What Mellowa uses"
  preferences), carry into next week (reflection + explicit carry-forward).
- **Every async failure preserves work.** The v19 additions keep this contract:
  `stale_day` (repair/regenerate) and `stale_week` (reflection) explain the day/week
  moved on and to refresh; all four repair failure exits state the previous plan is
  unchanged. No path implies lost work.
- **Current-day and weekly labels are timezone-correct** (MW-02 / MW-03).
- **"What Mellowa uses" matches real generation inputs** (MW-07 — one canonical model).

## Change

- `tests/mw14-premium-content.test.ts` (new, 12): asserts the three paid jobs are
  each present across the customer copy set; the v19 async-failure copy explains
  preservation + recovery; and no customer surface carries an unsupported claim
  (production-ready / guaranteed / medically effective / clinically proven / cure)
  or the retired product name.

## Not done here (out of scope / owner-run)

- The public + authenticated **browser** content/interaction assertions and the
  full multi-viewport (320/375, keyboard, reduced motion, screen-reader, 200% zoom)
  walk are Playwright suites run at the frozen candidate (see XAPP-02 / MW-01).
- No new product features were added (frozen scope) — this is a pass, not a build.

## Rollback

Delete the new test; no product code changed.
