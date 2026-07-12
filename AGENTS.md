<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# DailyFlow AI — Project Rules

DailyFlow AI is a consumer wellness web app that creates realistic daily plans for food, energy, mood, habits, hydration, movement, stress resets, and sleep routines.

**Core promise:** A simple daily plan for food, energy, mood and habits.

## Target users
- Busy women aged 25–45
- People with inconsistent routines
- People who want simple meals and habits without strict dieting
- People who need a gentle daily structure based on mood, energy, stress and schedule

## DailyFlow is NOT
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

## Technical stack
- Next.js App Router
- TypeScript (strict)
- Tailwind CSS
- Supabase Auth and Postgres, with RLS for data protection
- AI provider route for generation
- Zod for input/output validation
- Stripe Billing for subscriptions (monthly + yearly)
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
