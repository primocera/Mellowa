# Model routing, caching & degradation (Launch v6, Prompt 14)

## Model policy

`src/lib/ai/model-policy.ts` is the single source for per-route model,
temperature, max tokens, timeout and cost/latency budgets. Every
`generateStructuredJson` call passes its `route`, so policy edits apply
everywhere at once and show up in the ledger (`model`, `prompt_version`).
All routes currently use the configured default model; introducing a smaller
model for a low-complexity task requires eval evidence first
(docs/prompt-versioning.md).

## Deterministic content without AI

- Regenerated non-meal sections (breathing, relaxation, movement, evening)
  come from the reviewed curated library — no provider call, reservation
  released.
- The safety pre-classifier blocks unambiguous crisis input with zero AI.
- The daily-plan curated fallback is explicitly labeled and allergen-safe.

## Caching policy

Only two forms of reuse exist, both safe by construction:

1. **Static curated assets** — the wellbeing library ships in the repo.
2. **Exact idempotent results** — `generation_requests` (LS-7) returns the
   caller's own completed result for a duplicate request key, scoped by
   `user_id` and enforced by RLS.

Personalized AI output is **never** cached or shared across users. Do not add
a response cache to AI routes.

## Failure handling

- **Bounded retry**: exactly one retry, only for HTTP 429/529, with 0.5–1.5 s
  jitter — backpressure instead of request storms.
- **Circuit breaker** (`src/lib/ai/circuit-breaker.ts`): 5 consecutive
  provider failures open the circuit for 60 s per warm instance; a half-open
  probe restores it. Instance-local by design on serverless (documented
  best-effort); the global hard stop is the daily cost ceiling.
- **Degradation per route** (declared in the policy): daily-plan serves the
  labeled curated fallback; journal-reflection keeps the entry and withholds
  the reflection; the rest fail closed with a calm message. Provider outage
  therefore preserves safe core access without fake personalization.

## Kill switches

`AI_KILL_SWITCH` env var (Vercel) — comma-separated route names, model ids,
prompt versions, or `all`. Matching generations are refused before any
provider call and logged (`[ai] kill switch tripped`, route + model only).
Rollback = clear the env var and redeploy; no code change. The ledger keeps
the audit trail of what ran when.

## Visibility

Routing outcomes are already in the metrics report: per-route cost and status
mix from `ai_usage_events` (docs/metrics.md, docs/ai-cost.md).

## Known limits (deliberate, beta scope)

- Breaker state is per warm instance, not shared — a DB-backed breaker is not
  worth a round-trip per generation at this scale.
- No load-test under provider 429s yet; the retry cap (1) and rate limiter
  bound the blast radius. Revisit before public scale-up.
