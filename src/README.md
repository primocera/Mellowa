
## DailyFlow folder structure

- `src/app/(auth)` — login/signup routes
- `src/app/(app)` — authenticated app: dashboard, onboarding, today, check-in, weekly-plan, meal-rhythm, habits, journal, progress, settings, billing
- `src/app/api/ai/*` — AI routes (safety-check runs BEFORE every generation)
- `src/app/api/stripe/*` — checkout + webhook
- `src/components` — ui / layout / forms / dailyflow
- `src/lib` — supabase, ai, safety, stripe, utils, env (server-only env helper)
- `src/schemas` — Zod schemas (wellbeing, ai-output, safety)
- `src/prompts` — AI prompt templates
