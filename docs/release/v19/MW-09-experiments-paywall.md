# MW-09 — Bounded experiments, honest paywall timing, pricing discovery gate

**Outcome:** Growth changes are measurable without dark patterns or overlapping cohorts.
**Verdict:** completed for the low-risk integrations; billing/paywall UX unchanged (frozen). No Stripe change.

## Modules and their prior state

`experiments/framework.ts`, `paywall/gating.ts`, `pricing/discovery-gate.ts` were
test-only (no production caller); `experiments/registry.ts` was used only by
framework. The report already uses a separate `beta/experiments.ts` for conflict
detection — not replaced, to avoid two competing runtime systems.

## Change

- **Pricing discovery → report + admin** (a real caller of `pricing/discovery-gate.ts`):
  `buildMetricsReport` computes `pricingDiscovery = discoveryGate({ cohort, support })`
  and adds it to `MetricsReport` + CSV (`pricing_discovery` rows). The admin shows a
  read-only "Pricing discovery" card: **can-recommend-price-change = NO** until every
  required cohort is mature and no risk signal is present. This never touches Stripe,
  prices or the catalog.
- **Dark-pattern scanner in CI**: `tests/mw09-paywall-pricing.test.ts` runs
  `checkPaywallCopy` (from `paywall/gating.ts`) over the real pricing page,
  upgrade button and billing page — fails CI on fake urgency/scarcity/guilt/
  health-fear/confusing-close copy.
- **Experiments default-none**: verified/asserted `activeExperiments(now, {})` is
  empty and each experiment turns on only via its own kill-switch flag;
  `namespaceConflicts` reports same-namespace overlap (no silent cohort drift).

## Paywall timing (already enforced server-side — verified, not changed)

The Today adjust paywall is server-enforced: free/sample users get honest
entitlement copy and the server returns `402`; it never forces a paywall before
the lifetime sample delivers value, and voluntary pricing stays reachable. This
matches `shouldShowPaywall`'s policy (never nag premium/trialing, fail closed on
unknown, never before value), now additionally exercised as a CI contract. Because
billing is frozen at v16, the paywall *rendering* surfaces were not re-plumbed
through the pure function — the existing 402 gate is the production enforcement.

## Note

The registry still contains an off-by-default `repair_preview` experiment slot;
it is env-gated OFF and consistent with MW-10 Path A (a future test that would add
a real preview). Left as-is (not enabled).

## Tests

- `tests/mw09-paywall-pricing.test.ts` (14): experiments off by default + per-flag
  activation + namespace-conflict detection; `shouldShowPaywall` fail-closed/no-nag/
  post-value; dark-pattern scanner over three real copy files + a positive catch;
  discovery gate wired into report + admin; discovery module imports no Stripe/catalog.
- Existing `paywall-gating`, `discovery-gate` suites unchanged and green.

## Acceptance mapping

- Pricing changes blocked on immature evidence — enforced by the discovery gate verdict.
- Paywall timing enforced by production callers — the server 402 gate (verified) + CI copy contract.
- No cohort overlap / no experiment by default — asserted.
- Kill switch returns to safe control — `activeExperiments` filters on the kill-switch flag.

## Rollback

Revert the report/admin discovery wiring + the new test; no billing change to undo.
