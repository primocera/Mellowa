# Mellowa Content System (Content Elevation Playbook v6, Prompt 1)

The single vocabulary and voice reference for every customer-facing surface
and AI prompt. When copy and this document disagree, fix one of them.

## Positioning

- **Category:** adaptive daily wellbeing planning — not a diet app, wellness
  content library, habit tracker, therapy chatbot or medical service.
- **Core promise:** Mellowa shapes a realistic plan for the day you actually
  have. When your capacity changes, the plan changes with it.
- **Primary one-liner:** "A realistic wellbeing plan for the day you actually have."
- **Differentiation:** "No calorie targets. No streak pressure. No starting over."

## Message hierarchy

1. Situation — you may know what helps; deciding what fits *today* is hard.
2. Mechanism — a one-minute check-in captures energy, time and context.
3. Result — one realistic plan, lighter when needed.
4. Difference — no calorie targets, streaks, shame or rigid routines.
5. Trust — general wellbeing only; medical, crisis and severe-allergy needs
   are redirected safely.
6. Offer — one free sample day without a card; then a clearly disclosed
   3-day Premium trial.

## Voice principles

| Principle | Do | Avoid |
|---|---|---|
| Calm, not cutesy | "Make today lighter." | "Create my tiny plan." |
| Specific, not broad | "Choose an easy lunch and one 10-minute walk." | "Nourish your wellbeing." |
| Warm, not therapeutic | "That sounds like a lot for one day." | "Let's process what you're feeling." |
| Permissive, not apologetic | "Skip what does not fit." | Repeating "no pressure" everywhere. |
| Confident, not absolute | "Built around what you shared." | "Always perfect for your needs." |
| Adult, not infantilizing | "Lightest version." | "Tiny win", "little treat", emoji floods. |
| Neutral, not evaluative | "You checked in three times." | "Great job staying consistent." |

## Lexical rules

Reduce (not ban) — prefer the alternatives:

| Reduce | Prefer |
|---|---|
| gentle | realistic, lighter, manageable, steady, clear |
| calm | clear, unhurried, quieter, less to decide |
| tiny | lightest, easiest, minimum, one step |
| low-energy day | lighter day / capacity is low |
| wellness | daily wellbeing / daily structure |
| progress | patterns / what you noticed |
| failed | couldn't complete / wasn't saved |

"Gentle" and "calm" remain fine in a headline or a safety-adjacent sentence;
they become filler when they appear on every screen. Legal/safety-required
wording is exempt from stylistic replacement.

## Banned in customer copy (unless legally/safety required)

optimize yourself · discipline · cheat · clean eating · guilt-free · burn ·
fix your body · good/bad foods · perfect day · no excuses · stay on track ·
fall off · lazy · failure · cure · treatment · diagnose · therapist ·
guaranteed · unlimited · tiny plan · tiny habit

## Naming architecture

| Concept | Customer-facing name |
|---|---|
| Today hub | Today |
| Weekly hub | Week (was: Plan) |
| Library hub | Library |
| Progress hub | Patterns (was: Progress) |
| Account hub | You |
| Calm practices | Resets (was: Calm) |
| Low-energy flow | Make today lighter |
| Minimum version | Easiest version (customer copy; internal mode ids unchanged) |

Internal database fields, route paths and plan-mode values are NOT renamed
for display reasons — display copy maps over them.

## Claims

Never invent testimonials, user counts, outcomes or medical claims. Billing
copy uses the shared `PREMIUM_FEATURES` list (`src/lib/stripe/plans.ts`) —
"Personalized daily plans, with fair-use safeguards", never "unlimited".
Sample vs trial language: "sample" before checkout, "trial" only after the
user chooses a plan; payment method and exact charge date are always
disclosed next to the trial CTA.

## Where copy lives

- Shared product/billing terminology: `src/lib/content/terminology.ts`
- Billing features: `src/lib/stripe/plans.ts` (`PREMIUM_FEATURES`)
- Regression tests: `tests/content-system.test.ts`, `tests/funnel-copy.test.ts`
