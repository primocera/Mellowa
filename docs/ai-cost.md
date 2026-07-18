# AI usage ledger & cost (Launch & Scale v6, Prompt 11)

Turns the reservation *estimate* into an auditable ledger with provider token
truth, actual cost, latency and outcome status — without ever storing raw
prompts or responses.

## Lifecycle of a ledger row (`ai_usage_events`)

1. **Reserve** — `claim_ai_generation` inserts a row with `status = 'reserved'`
   and the route estimate, under a per-user advisory lock (atomic rate-limit +
   global daily ceiling). Returns the `event_id`.
2. **Generate** — `generateStructuredJson` writes provider truth into a
   `UsageSink`: `input_tokens`/`output_tokens` (from the provider response),
   `model`, `latency_ms` and the attempt outcome — on success **and** on every
   failure path (timeout, provider error, invalid JSON, schema failure).
3. **Finalize** — the route calls `finalizeAiUsage(eventId, …)`, advancing the
   row to its outcome with summed tokens across retries, `actual_cost_usd`,
   `latency_ms`, `retry_count`, `fallback_used` and `result_id`.

## Status values

`reserved` · `success` · `fallback` · `quality_failed` · `safety_blocked` ·
`invalid_json` · `schema_failed` · `timeout` · `provider_error` · `released`.

- **Released** = reserved but the provider was never called (e.g. a validation
  or check-in save failure after the claim). Contributes **zero** to the daily
  ceiling so an aborted request never counts as spend.
- **quality_failed / safety_blocked** = the provider *was* called and billed,
  but the plan was rejected by the quality or allergen gate. Cost is still
  recorded; retries are visible via `retry_count`. No content is stored.

## Billing truth

Actual cost is charged whenever a call **returned tokens** — including
`invalid_json` / `schema_failed`, because the provider bills for the response
regardless of whether we could parse it. A `fallback` (static plan, provider
returned nothing) costs zero. Pure `timeout` / `provider_error` / `released`
rows have no tokens and no cost.

## Versioned pricing

`PRICING` in `src/lib/ai/cost.ts` is keyed by provider + model + **effective
date**. `priceFor(model, at)` picks the newest entry effective on or before the
generation date, so historical rows keep historical prices and a model/price
change is a new row, not an edited constant.

## Reservation vs. actual, and the ceiling

The global daily ceiling (`claim_ai_generation`) now sums
`coalesce(actual_cost_usd, estimated_cost_usd)` and ignores `released` rows — so
once actuals land, the ceiling reflects reality and a user is never shown a
capacity message merely because the *estimate* drifted above the real spend.

## Reconciliation & tolerance

Daily actual cost should track the reservation estimate within **±25%** per
route (see `tests/ai-cost.test.ts`). A larger sustained gap means the route
token estimate in `ROUTE_TOKEN_ESTIMATE` needs updating. Failed and retried
calls are fully visible in the ledger (`status`, `retry_count`, `fallback_used`)
without any prompt/response content.

## Wiring status

Finalized end-to-end: **daily-plan** (incl. quality/allergen retries and
fallback) and **weekly-plan**. Other AI routes still reserve and rate-limit
correctly; their rows remain `reserved` until finalized in a follow-up (they
follow the same `UsageSink` → `finalizeAiUsage` pattern). Because the ceiling
uses same-day rows only, unfinalized reservations don't distort future days.

## Budget alerts

Per-day / per-route / per-paying-user spend is surfaced by the metrics report
(`docs/metrics.md`) built on this ledger. Alerts fire on the metrics side, not
by blocking generation — the ceiling remains the only hard stop.

## Operational follow-up

- Run migration **`023_mellowa_v6_ai_usage_ledger.sql`** in the live project.
- Keep `PRICING` current when the model or provider price changes (add a row
  with the new `effective` date; never edit an old one).
