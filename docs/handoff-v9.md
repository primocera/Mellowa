# Mellowa v9 — handoff (Prompt Pack v9, MW-V9-00 … MW-V9-12)

Companion to `docs/launch-go-no-go-v9.md`. Per Priloga B: what shipped, how to
operate it, and what remains owner-run before a public paid launch.

## Outcome — the paid problem solved

v9 turns the v8 feature set into a coherent, trustworthy adaptive-day product:
one clear daily job (Now), a repair the user can trust (exact scope, factual
diff, safe Undo), a transparent memory the user controls, a weekly loop that
carries real choices forward, a differentiated commercial story, real PWA/mobile
polish, and the unit-economics + fair-use + billing-reliability + analytics
discipline needed to run a measured beta. No feature was rebuilt where v8 already
implemented it; each prompt closed the remaining trust/economics/clarity gap.

## Changed files by area (12 commits, `d725c9e` … `96811b6`)

**UX / content**
- `src/components/layout/app-nav.tsx`, `src/app/(app)/layout.tsx`, `library/page.tsx`, `you/page.tsx` — Now-first IA.
- `src/components/dailyflow/checkin-form.tsx` — pre-generation summary, `checkin_started`.
- `src/components/dailyflow/today-plan-v2.tsx` — Now undo, repair deterministic diff + scope + version-checked Undo.
- `src/components/dailyflow/mellowa-learned.tsx` — Weekly carry-forward group + Reset learned preferences.
- `src/components/dailyflow/favourites-view.tsx`, `plan-preferences-form.tsx` — live allergen badges, pantry chips.
- `src/app/(app)/today/page.tsx`, `weekly-plan/page.tsx`, `weekly-reflection.tsx`, `weekly-plan-view.tsx` — Week loop.
- `src/app/page.tsx`, `pricing/page.tsx` — landing wedge, mechanism, Premium jobs, yearly-emphasis flag.
- `src/components/ui/index.tsx`, `src/app/(app)/error.tsx`, `today/loading.tsx`, `weekly-plan/loading.tsx` — shared UI + boundaries.
- `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `src/app/manifest.ts`, `layout.tsx` — PWA.

**Backend / data**
- `src/lib/today/next-action.ts` — `NOW_SELECTOR_VERSION`.
- `src/lib/plan/repair.ts` — `deterministicDiff`; `src/app/api/ai/plan-repair/route.ts` — version-checked Undo, honest outcomes.
- `src/lib/week/reflection.ts` — canonical `reflectionSelectionsFromRow` / `isReflectionFresh`; `src/app/api/plan/feedback/route.ts` — carry-forward view + reset-all.
- `src/lib/ai/fair-use.ts`, `rate-limit.ts`, `guard.ts` — monthly fair-use cap.
- `src/lib/analytics/metrics.ts`, `report.ts`, `taxonomy.ts` — usage scorecard + full value_loop funnel.

**Commercial / safety**
- `src/lib/stripe/plans.ts` (matrix verified, unchanged prices), `src/lib/flags.ts` (`monthly_fair_use`, `isYearlyEmphasisEnabled`).

**Tests / docs**
- New: `tests/pwa-ui.test.ts`, `tests/unit-economics.test.ts`; extended: navigation, checkin-copy, next-action, plan-repair, feedback-learned, weekly-reflection, meal-continuity, week-copy, landing-conversion, value-analytics.
- Docs: `PRODUCT_ELEVATION_V9.md`, `launch-go-no-go-v9.md`, `beta-research.md`, `runbooks/monitoring-alerts.md`, `runbooks/live-transaction-rehearsal.md`, `seo-pwa.md`.

## Migrations, flags, rollback

- **Migrations (additive, owner-applies to live before deploy):** `034` version-checked
  repair Undo overload; `035` monthly fair-use claim overload. Both add overloads
  only — the prior functions are unchanged, so rollback needs no migration reversal.
- **Flags:** `FLAG_MONTHLY_FAIR_USE` (default on; off ⇒ infinite monthly cap),
  `FLAG_EMPHASIZE_YEARLY` (default off), plus v8 `FLAG_PLAN_REPAIR`,
  `FLAG_WEEKLY_REFLECTION`. Env-only, no deploy. `AI_MONTHLY_GENERATION_CAP`,
  `AI_GLOBAL_DAILY_CEILING_USD` tune the numbers.

## Analytics events (v9 additions)

- `primary_nav_viewed` (client; `surface`, `entitlement`) — which destination is used.
- `checkin_started` (client; `surface`) — do openers finish the check-in.
- No new server-authoritative events; the extended `value_loop` funnel reuses
  existing server-confirmed milestones. Prohibited fields unchanged (no scales,
  notes, allergies, plan/meal/journal content, custom names, email).

## Exact commands & results (at RC `96811b6`)

`npm run lint` → 0 errors / 8 pre-existing warnings · `npm run typecheck` → clean
· `npx vitest run` → **604 passed / 73 files** · `npm run build` → clean ·
`git diff --check` → clean. Skipped/owner-run: `npm run test:e2e` (authenticated,
needs seeded user), live Stripe/Supabase/reminder rehearsal.

## Contract invariants preserved

Safety classification before every AI generation, fail-closed; blocked input
never generates, spends entitlement or upsells; allergen gate omits (never
substitutes); prices €9.99/€59.99 unchanged, no testimonials, no "unlimited";
sample = one plan + one bounded non-meal adjustment, no card; analytics strict
bounded enums; `.docx` never committed.

## Blockers before public paid launch (owner)

P0: live transaction rehearsal; apply migrations `034`/`035` to live Supabase.
P1: authenticated seeded E2E; reminder/cron/email live rehearsal. Full detail,
owners and acceptance in `docs/launch-go-no-go-v9.md` §4–§5. **Verdict: NO-GO for
public paid launch, CONDITIONAL GO for a capped beta** — honest and expected.
