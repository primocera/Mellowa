# AI output quality gates (Launch v6, Prompt 13)

Every AI surface validates its output BEFORE it is saved or shown. No surface
bypasses its policy; unsafe output is never persisted.

## Policy per route

| Route | Validator | Extra rules |
|---|---|---|
| daily-plan | `checkDailyPlanV2Quality` + `findPlanAllergenViolations` | mode density limits, safety notes, retries + curated fallback (allergen-safe) |
| weekly-plan | `checkWeeklyPlanOutput` | text allergen scan over meal structure + shopping list, focus habit required |
| meal-rhythm | `checkMealRhythmOutput` | text allergen scan over all ideas |
| habit-plan | `checkHabitPlanOutput` | every habit needs a minimum version |
| low-energy-day | `checkLowEnergyDayOutput` | allergen scan on easy meals, tiny-habit minimum version |
| journal-reflection | `checkJournalReflectionOutput` | forbids diagnosis, clinical interpretation, crisis counselling, certainty about emotional state, clinical referrals |
| regenerate-section | `checkRegeneratedMealOutput` + meal allergen gate | curated (non-meal) sections come from the reviewed library — no AI call |

All validators share `BANNED_PATTERNS` (medical/therapy/diet-culture/shame/
cheerleading/pseudo-clinical/moral-food language) from
`src/lib/ai/quality-checks.ts`.

## Retry policy

At most **one** regeneration with a safe corrective instruction
(`correctiveInstruction`, plus `allergenExclusionInstruction` when allergens
were involved), then **fail closed**: 502 with a calm user message, or for the
journal reflection, the entry stays saved and the reflection is withheld.

## Ledger

Failures land in `ai_usage_events` as `quality_failed` (or `safety_blocked`
when the final failure was an allergen), with summed tokens across both
attempts, `retry_count = 1` and `prompt_version` — never the content itself.

## Regression coverage

`tests/output-guards.test.ts` has a fixture for every rejection reason;
`tests/eval-suite.test.ts` (LS-12 corpus) covers safety categories end-to-end.
