# MW-95-05 — onboarding field data-location & retention

Design chosen: **memory-only answers + a non-sensitive step index in
localStorage** (the proportionate fallback the prompt allows for a calm ~2-minute
flow). No server-side `onboarding_drafts` table is introduced, so there is no new
row to export/delete/expire — the only durable record is the canonical
`wellbeing_profiles` baseline written at completion, already covered by the
account export/delete flows.

## Where each onboarding field lives before completion

| Field | In React memory (this tab) | localStorage | Analytics/logs |
|---|---|---|---|
| wake_time / sleep_time | yes | **no** | no |
| work_schedule | yes | **no** | no |
| primary_goal | yes | **no** | no |
| food_preferences | yes | **no** | no |
| allergies | yes | **no** | no |
| allergies_severe (flag) | yes | **no** | no |
| disliked_ingredients | yes | **no** | no |
| cooking_time / budget_level | yes | **no** | no |
| energy_baseline | yes | **no** | no |
| stress_baseline | yes | **no** | no |
| sleep_quality_baseline | yes | **no** | no |
| movement_level / preferred_tone | yes | **no** | no |
| safety_acknowledged / is_adult | yes | **no** | no |
| **step index (0–5)** | yes | **yes** (`mellowa.onboarding.progress.v2`, `{ step }` only) | no |

No answer value is ever serialized to storage or telemetry. The only analytics
emitted are `onboarding_started` (client view, surface only) and, at completion,
the server-authoritative `onboarding_completed` (surface only) — see MW-95-03.

## Retention & cleanup

- **On load:** the retired full-draft key `mellowa.onboarding.draft.v1` is
  removed with `localStorage.removeItem`; its value is never read, parsed, logged
  or sent anywhere.
- **During the flow:** only `{ step }` is written, on step change.
- **On successful completion:** both `mellowa.onboarding.progress.v2` and the
  legacy key are removed, after the `wellbeing_profiles` baseline write succeeds
  and before the redirect.
- **On reload mid-flow:** the step index is restored (clamped to a valid range);
  answers, being memory-only, are re-entered. The UI says so plainly: “Your place
  is kept on this device — answers stay in this tab.”

## Rollback

Pure client change plus one analytics-authority route (MW-95-03). No migration,
no flag. Reverting the wizard commit restores the previous behavior; the retired
localStorage key is already purged on any load that ran the new code.
