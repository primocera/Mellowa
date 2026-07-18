# Content QA & claim audit — v6 release gate (CE-20)

Gate for the Content Elevation v6 rollout. Confirms the product tells **one
truthful, safe, premium story** at the release commit. Automatable invariants
are locked by `tests/content-audit.test.ts` (+ `tests/content-system.test.ts`);
the human-owned items below must be signed off before a **public paid** launch.

## Verdict

**GO for the 25–50 person beta.** No P0 content-truth or safety-copy mismatch
remains in the codebase. Public paid launch stays **NO-GO** until the human-owned
items (comprehension sessions, axe/screenshot sweep, crisis-number
re-verification) and the outstanding Launch & Scale P1s are closed.

## Checklist status

| # | Final content checklist item | Status | Evidence |
|---|------------------------------|--------|----------|
| 1 | Primary promise consistent, not a per-screen slogan | ✅ | `page.tsx` hero + metadata + auth layout share "realistic plan for the day you actually have"; not repeated on every screen |
| 2 | Sample / trial / payment method / charge date / renewal never conflated | ✅ | CE-4 pricing (fafc67d), `TERMS.sampleHelper`, LS-2 funnel |
| 3 | No unsupported "Popular"/"unlimited"/outcome/testimonial claim | ✅ | banned-phrase scan (content-system + content-audit tests); no invented counts |
| 4 | Today has one hierarchy; lighter modes materially shorter | ✅ | CE-8 (6b248a5), CE-9 (c1b1e53) |
| 5 | "Gentle"/"calm"/"no pressure" used selectively, not filler | ✅ | Remaining uses are AI-prompt guidance, curated library categories, or single deliberate lines — not marketing filler |
| 6 | No "tiny plan"/infantilizing language | ✅ | Replaced by "Make today lighter" / "Easiest version" (CE-9/CE-12); banned in tests |
| 7 | Progress reframed as Patterns, self-reported non-causal | ✅ | CE-12 (62bbfee); "self-reported entries, not health conclusions" |
| 8 | Errors preserve effort, give one next action | ✅ | CE-15 microcopy map (c69e9c8) |
| 9 | Blocked safety states contain no plan or upsell | ✅ | content-audit test asserts no upsell verbs in safety copy; crisis flow returns resources only |
| 10 | Emails: exact billing facts, no sensitive wellbeing detail | ✅ | CE-17 (6e97f88) + billing-facts; content-audit test bans per-user disclosure + emoji |
| 11 | AI output passes density/voice/diet-culture/pseudo-clinical regressions | ✅ | CE-18 (08747d6) voice rules + quality-checks |
| 12 | Works at mobile widths, keyboard/SR, future string expansion | ⚠️ partial | CE-19 rules + Playwright mobile/overflow checks pass; **manual axe + SR pass still owed** |

## Known minor notes (P2, non-blocking)

- Canonical constant `TERMS.promise` includes "wellbeing" ("A realistic
  **wellbeing** plan…") while the rendered hero/metadata omit it ("A realistic
  plan…"). Both are truthful and the through-line phrase is identical; left as-is
  to keep the hero tight. Revisit only if a single exact string is desired.

## Human-owned open items (owner: Primoz, before public paid launch)

1. **Comprehension sessions** — at least 5 target users read landing → signup →
   onboarding → Today → trial → billing; confirm one coherent story, no
   confusion between sample and trial. (CE-20 requirement; cannot be automated.)
2. **Accessibility sweep** — run axe + keyboard + screen-reader on the
   authenticated surfaces; capture 375px + desktop screenshots for the record.
3. **Crisis-number re-verification** — `CRISIS_RESOURCES` last verified
   2026-07-16; re-verify each number with the safety owner (at least every 6
   months) before paid launch.
4. **Stripe full-cycle manual run** — follow the runbook in `docs/testing.md`
   (trial → payment_failed → cancel → delete) in test mode once before beta.

## How this gate is enforced

- `npm run test` includes `content-audit.test.ts` and `content-system.test.ts`.
- `npm run test:e2e:public` covers landing/pricing/legal copy + mobile overflow.
- Re-run this gate at the exact commit you deploy; update the table above if any
  surface changes.
