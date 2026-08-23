<!-- BEGIN:project-phase -->
# CURRENT PHASE: MVP launch — closing owner-named gaps, then marketing

The engineering build is broadly complete. The owner directs the work:

- **v21 (owner-authorized MVP closure) — EXECUTED.** The owner explicitly named the
  gaps in `Mellowa_MVP_Launch_Closure_v21` (Prompt 2) and asked for them to be built
  on top of the existing code. Executed on branch `v21`: fail-closed required-context
  reads in `plan-repair` and `regenerate-section` (WS-A), a bounded provider deadline
  under the daily-plan claim lease (WS-B), and ONE canonical `LAUNCH_MODE` contract
  shared by the release check and runtime readiness (WS-C). No new migrations; owner
  gates (RC cut, prod migrations 050–054, live money) remain owner-only and were NOT
  run. See `docs/release/v21/MELLOWA-CLOSURE-CERTIFICATION.md`.

- **Default remains marketing/users, not more engineering.** Do **not** invent a new
  engineering / hardening / elevation / scale / security *pack* for its own sake, and
  do not audit for gaps unprompted (this went wrong at v19 and v20). Copy, plans and
  experiments are the ordinary next work. Read
  [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md) before proposing any pack.

- **Coding is open** for real bugs, small polish, and explicit owner requests like
  v21 — that is a priority, not a freeze.
<!-- END:project-phase -->

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Mellowa — Project Rules

Mellowa is a consumer general-wellbeing web app that helps people follow a gentle daily routine for food, energy, mood, habits, hydration, movement, stress resets and sleep — and, crucially, **reshapes the plan when the day changes** instead of leaving a stale to-do list behind.

> Historical note: this project was previously named "DailyFlow AI". "DailyFlow" survives only in labeled migration history and internal folder paths; it must not appear in customer-visible copy or in these agent instructions as the product name. The product is **Mellowa** (live at mellowa.app).

**Core promise:** A realistic wellbeing plan for the day you actually have.

## The adaptive-day mechanism (what makes Mellowa Mellowa)
- The plan is not a fixed checklist. When the day changes, Mellowa **reshapes what is left** — a single pass over the remaining part of the day — rather than regenerating from scratch.
- **Completed items are kept.** Adjusting the rest of the day never erases what the user already did.
- **Undo is free.** Reversing an adjustment costs no paid generation.
- On a low-capacity day, the plan gets **lighter** (fewer things to do), never heavier.
- **Preference learning is visible, editable and removable.** The plan reuses what worked before, and the user stays in control of what it learned — they can see it, change it and delete it.

## Target users
- Busy women aged 25–45
- People with inconsistent routines
- People who want simple meals and habits without strict dieting
- People who need a gentle daily structure based on mood, energy, stress and schedule

## Mellowa is NOT
- a medical app
- a therapy app
- an eating disorder recovery tool
- an emergency mental health tool
- a calorie/macro obsession app
- a disease-specific nutrition plan generator

## Product scope
The app helps users create:
1. A personal wellbeing profile
2. A daily check-in
3. A personalized daily routine plan
4. Simple meal rhythm ideas
5. Hydration rhythm
6. Movement moments
7. Stress reset suggestions
8. Sleep wind-down routine
9. Weekly plan and shopping list
10. Habit tracking and gentle progress review

## Free vs paid (the commercial truth)
- **Free:** creating an account and completing the wellbeing setup is free, plus **one lifetime sample** daily plan (and one lifetime sample section adjustment) to preview the product. No payment method is required for the free sample.
- **Trial:** a Premium trial begins **only when the user chooses a plan** and continues to checkout — not at signup. The exact charge date and amount (in the user's currency) are shown before checkout, and one trial per person, ever.
- **Premium:** continues the daily and weekly loops — ongoing daily plans, whole-day adjustment with free Undo, make-today-lighter, preference learning, saved meals/leftovers/shopping drafts, weekly plans with a reflection, journal reflections and progress insights — all with **fair-use safeguards** (never "unlimited").
- Pricing is USD-first with an EUR region price; every price/saving figure a surface shows is derived from the one catalog per currency (`src/lib/stripe/plans.ts`), never a hardcoded literal or a "Save 50%" claim.

## Technical stack
- Next.js App Router
- TypeScript (strict)
- Tailwind CSS
- Supabase Auth and Postgres, with RLS for data protection
- AI provider route for generation
- Zod for input/output validation
- Stripe Billing for subscriptions (monthly + yearly), USD-first with an EUR region price via `currency_options`
- Vercel deployment

## Safety and product rules (MANDATORY)
- Never diagnose, treat, or provide medical advice.
- Never provide emergency mental health support.
- Never create restrictive diets, extreme fasting, purging advice, or shame-based advice.
- Never give disease-specific meal plans for diabetes, kidney disease, cancer, pregnancy, eating disorders or other medical conditions.
- If user input suggests self-harm, harm to others, eating disorder behavior, severe crisis, or medical emergency: stop normal generation and return a safe support message.
- Every AI generation route MUST run a safety classification BEFORE generating a plan.
- Normal plans must be gentle, realistic, simple, non-judgmental and adaptable.
- Low energy → simplify the plan.
- High stress → reduce tasks and add one small reset.
- Low mood → supportive language and one doable action.

## Coding rules
- Use strict TypeScript.
- Prefer server components where appropriate.
- Keep secrets out of client code; SUPABASE_SERVICE_ROLE_KEY and Stripe secret keys are server-only.
- Validate all inputs and AI outputs with Zod.
- Use structured JSON for generated plans; store AI outputs in jsonb columns.
- Keep components small and reusable.
- Use clear error handling and loading states.
- Billing, entitlement, trial eligibility, quota and security checks must **fail closed** when state cannot be verified — never treat a failed read as "no subscription", "no trial used" or "zero usage".
- Keep UI warm, calm, minimal and mobile-first.

## UI rules
- Background: #FAF7F2 or #F8F7F4
- Cards: #FFFFFF
- Main text: #1F2937
- Muted text: #6B7280
- Primary accent: #7C9A92 or #6D8C7D
- Secondary accent: #EDE9FE or #EEF2FF
- Warning: #FEE2E2
- Success: #DCFCE7
- Rounded cards, soft spacing, calm typography, non-clinical wellness design.

## Quality rules
- Before finishing every task, run npm run lint, npm run typecheck and npm run build if scripts exist.
- Show changed files and assumptions.
- Do not silently skip safety logic.
- Do not implement AI generation without safety classification first.
- Do not add medical claims or therapy language.
