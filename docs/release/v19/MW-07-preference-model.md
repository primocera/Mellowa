# MW-07 — Versioned preference model wired into real generation and controls

**Outcome:** What Mellowa says it learned exactly matches what changes future plans.
**Verdict:** completed (code + tests). No migration.

## Before

Two parallel derivations existed:
- `src/lib/feedback/learned.ts` (`deriveLearned`, no decay) — used by the daily-plan
  generation route, the personalization center (`/api/plan/feedback` GET) and the
  reset-learned control.
- `src/lib/feedback/preferences.ts` (`buildPreferences`, the versioned model with
  60-day **decay**, confidence, expiry, `whyUsed`) — **no production caller**.

So the model shown/removed in the UI (no decay) was not exactly the model that
shaped a plan, and expired inferred preferences could still influence generation.

## Change — one canonical model everywhere

- **`learned.ts`**: exported the canonical phrase accessors `labelForSignal`,
  `hintForSignal`, `MAX_PROMPT_HINTS` (single phrase source; no duplicated copy).
- **`preferences.ts`** (now canonical): added
  - `preferencesToPromptHints(prefs)` — the bounded generator hint block, reusing
    the same canonical phrases;
  - `preferenceToView(pref)` → `{signal,label,effect,whyUsed,source,confidence,count,lastSeen,expiresAt}`
    for the personalization center;
  - `todayContradictions(checkin)` — deterministic precedence: good energy (≥4)
    outranks inferred `too_much`; "Flexible today" outranks inferred `too_little_time`.
- **`api/ai/daily-plan/route.ts`**: generation now builds `buildPreferences(feedback, suppressions)`
  → `applyCurrentContext(…, todayContradictions(checkin))` → `preferencesToPromptHints`.
  Replaces the `deriveLearned`/`learnedToPromptHints` path. Suppression query unchanged.
- **`api/plan/feedback/route.ts`**: the "What Mellowa uses" GET and the reset-active-signals
  flow both read `buildPreferences` → `preferenceToView`. An expired (60-day) or removed
  preference shown here is exactly one that no longer shapes a plan.
- **`components/dailyflow/mellowa-learned.tsx`**: surfaces the new `whyUsed`
  ("Why: you told us…") alongside the effect. Raw confidence is not shown (avoids
  implying certainty about the person).

## Invariants preserved

- Inferred-only, closed verdict set; free-text notes never become memory (unchanged).
- Removal boundary / free Undo semantics unchanged (`buildPreferences` honours
  suppression the same way `deriveLearned` did).
- Reset still only suppresses active signals and never deletes `plan_feedback`.

## Tests

- `tests/preferences-model.test.ts` (+5 MW-07 cases): prompt-hint phrase parity,
  empty→"", view mapping (label/effect/why/source/expiry, canonical slug),
  `todayContradictions` energy/time, end-to-end precedence dropping a hint.
- `tests/feedback-learned.test.ts`: the reset-scope test updated to assert the
  canonical `buildPreferences` (its real invariant — reset preserves history,
  never deletes feedback — is unchanged and still asserted).
- Existing `deriveLearned` unit tests untouched (the function is retained).

## Notes / not done (out of scope, owner-gated or already-correct)

- Weekly generation currently carries forward the weekly reflection (its own
  explicit carry-forward), not the inferred feedback model; that mapping was
  already unified (`reflectionSelectionsFromRow` → `reflectionToWeeklyHints`) and
  is left as-is — the pack's "one canonical model" concern was the daily/UI split.
- Export/delete already cover `plan_feedback` and `learned_signal_suppressions`
  rows (privacy registry); no opaque second preference table was introduced.

## Rollback

Revert the route/lib/component changes; `deriveLearned` remains available.
