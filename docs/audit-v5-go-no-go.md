# Mellowa v5 Audit — Go / No-Go Report

**Branch:** `v5` · **Base:** `main` · **Commits:** 19 · **Unit tests:** 119 passing across 20 files · **Prompts implemented:** 19 of 20 (this report is Prompt 20).

## Recommendation: **GO, conditional on the deployment checklist below.**

All P0 release blockers and P1 improvements from the audit are implemented, tested, linted, type-checked and building cleanly. The remaining risks are **not code** — they are external configuration and human review that cannot be verified from the repository. They are listed as owner TODOs and must be completed before the paid launch (`LAUNCH_MODE=paid`).

---

## What was verified in-repo

| Area | Prompt | Evidence | Status |
|---|---|---|---|
| Cron/admin routes fail-closed | 1 | `cron-auth.ts`, `instrumentation.ts`, `tests/cron-auth.test.ts` | ✅ |
| Durable, truthful email delivery | 2 | `email/deliver.ts`, migration 014, `tests/email-delivery.test.ts` | ✅ |
| Subscription entitlement matrix | 3 | `stripe/plans.ts` `entitlementFor`, migration 015, `tests/entitlement.test.ts` | ✅ |
| GDPR export/delete/retention | 4 | `privacy/registry.ts`, `retention.ts`, `tests/privacy-registry.test.ts` | ✅ |
| Safety matrix, fail-closed | 5 | `safety/pre-classify.ts`, `tests/safety-matrix.test.ts` | ✅ |
| Adult gate + versioned consent | 6 | migration 016, `consent/*`, `tests/consent.test.ts` | ✅ |
| Meal & allergy safety | 8 | `safety/allergens.ts`, `severe-allergy.ts`, migration 017 | ✅ |
| Timezone / local-day | 9 | `dates/local-day.ts`, `tests/local-day.test.ts` | ✅ |
| Macros opt-in by design | 7 | migration 018, `tests/macros-optin.test.ts` | ✅ |
| Navigation → 5 hubs | 10 | `layout/app-nav.tsx`, hub pages, `tests/navigation.test.ts` | ✅ |
| Calmer Today, one reset | 11 | `today/disclosure.ts`, `tests/today-disclosure.test.ts` | ✅ |
| Resumable onboarding | 12 | `onboarding/validation.ts`, `tests/onboarding-validation.test.ts` | ✅ |
| Servings/category/traceable shopping | 13 | `shopping/aggregate.ts`, `tests/shopping-aggregate.test.ts` | ✅ |
| Transparent feedback learning | 14 | `feedback/learned.ts`, migration 019, `tests/feedback-learned.test.ts` | ✅ |
| Neutral Progress | 15 | `progress/neutral.ts`, `tests/progress-neutral.test.ts` | ✅ |
| Crisis localization | 16 | `safety/crisis-resources.ts`, `tests/crisis-resources.test.ts` | ✅ |
| Legal & production config | 17 | `legal/config.ts`, `tests/legal-config.test.ts` | ✅ |
| CI + Playwright E2E | 18 | `.github/workflows/ci.yml`, `playwright.config.ts`, 16/16 public E2E | ✅ |
| Accessibility & content QA | 19 | skip link, reduced-motion, live regions, `tests/accessibility.test.ts` | ✅ |

## Copy vs. actual access — spot checks
- Pricing says "Personalized daily plans, with fair-use safeguards" (not "Unlimited"). ✅
- Trial disclosure states payment method required + charge date + auto-renew. ✅
- Used-trial users routed to "Pay today" via `entitlementFor`. ✅
- No medical/therapy claims; safety boundaries return support messages, not plans. ✅

---

## Blocking owner TODOs before paid launch (cannot be verified from code)

1. **Apply database migrations 014–019** to the production Supabase project, in order, in one batch. All are additive.
2. **Set operational secrets** in Vercel: `CRON_SECRET`, `ADMIN_STATS_SECRET` — boot refuses without them in production (`instrumentation.ts`).
3. **Legal config** (`legal/config.ts`): replace placeholder entity/address/domain/emails; production build rejects placeholders. Requires **legal counsel review** of Terms, Privacy, refund policy — human task, not automatable.
4. **Stripe live**: confirm price IDs map in `stripe/plans.ts`; verify webhook endpoint + signing secret; test one real trial→charge→cancel.
5. **Resend**: verify sending domain + `RESEND_API_KEY`; confirm scheduled-send reminders deliver.
6. **Supabase Auth redirect URLs** + email confirmation enabled for the production domain.
7. **Rotate any keys** committed or shared during development.

## Non-blocking follow-ups (severity: low)
- Two pre-existing lint warnings (`flags.ts` KNOWN_FLAGS type-only; `safety-matrix.test.ts` `_row`) — cosmetic.
- Full axe automation was intentionally omitted to keep CI light on free tier; primitives (landmarks, live regions, reduced-motion, 44px targets) are in place and covered by `tests/accessibility.test.ts`. Add `@axe-core/playwright` later if a heavier a11y gate is wanted.
- Authenticated E2E journeys self-skip without test Supabase/Stripe keys; wire those in CI when a test project exists.

## Verification commands
```
npm run lint && npm run typecheck && npm run build && npx vitest run
```
