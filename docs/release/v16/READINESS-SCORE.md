# v16 readiness score & launch decision — Mellowa (XAPP-95-02)

Non-compensating rubric. Computed by `scoreReadiness`
(`src/lib/release/readiness-score.ts`) from the machine manifest
`docs/release/manifest.v16.json`; fixtures in `tests/readiness-score.test.ts`.
Product, capped-beta and public-paid are scored **separately** — a failed gate is
never averaged away — and 9.5 is an internal confidence standard, **never**
landing copy, a testimonial or a "proven" claim.

Reproduce: `node`/vitest over `scoreReadiness({ manifest })` at the current SHA.
The three tiers do not combine into one number by design.

## Scores at the current v16 state (draft, no frozen candidate)

| Tier | Score | Cap that fired | Reads as |
|---|---|---|---|
| **Product capability** | **8.5** | none (no engineering P0 defect) | contracts green (vitest 1491/1491, tsc, lint, build); not yet frozen with SHA-pinned evidence |
| **Capped-beta readiness** | **8.9** | no frozen candidate | ready to freeze + deploy; the authenticated matrix is the one accepted risk for a bounded cohort |
| **Public-paid readiness** | **7.9** | open P0-LIVE-TRANSACTION (P0) blocks public paid | owner live-money + authenticated gates unrun; no mature value window |

Caps applied before any total. No cap is bought back by other points.

## Why each tier is where it is

- **Product 8.5.** All automated contracts pass and there is no open engineering
  P0 defect — MW-95-01 (Stripe Customer ownership), XAPP-95-01 (cross-app
  isolation), MW-95-04 (honest billing state) and MW-95-05 (no sensitive draft in
  localStorage) closed real defects this cycle. It is not 9.0+ because the gates
  are not yet frozen with SHA-pinned evidence at a candidate (v16 is a draft).
  An owner-run live-money gate does **not** cap product capability — it is not a
  code defect.
- **Capped-beta 8.9.** Nothing blocks a bounded invite beta; it needs a **deploy**,
  not more evidence. It cannot read 9.5 until a candidate is frozen and the
  authenticated core journeys are observed at that SHA (or explicitly accepted for
  the bounded cohort, as in the v15 decision).
- **Public-paid 7.9.** Capped below 8 by the open P0 live-money gate, and
  independently below 9 by two unrun owner gates (authenticated E2E at candidate,
  live-money rehearsal) and the absence of a mature value window. This is the
  honest floor, not a setback.

## Blockers (owner-gated — no prompt can close them)

| Id | Level | Blocks | Gate |
|---|---|---|---|
| P1-AUTH-E2E-AT-HEAD | P1 | capped_beta, public_paid | authenticated matrix at the frozen candidate |
| P0-LIVE-TRANSACTION | P0 | public_paid | live charge→cancel→reactivate→recover→refund, recorded |

## Mellowa mature-value hypotheses (predeclared — do not change after seeing data)

Public-paid 9.5 additionally requires a complete, mature window meeting: D2 ≥ 40%;
D3 ≥ 30%; repair applied ≥ 50% of `plan_repair_requested` (MW-10: there is no
before-commit preview event, so the executable funnel is
`plan_repair_completed / plan_repair_requested`; same 50% target); Week closeout
≥ 25% of second-week users; carry-forward ≥ 50% of closeouts; trial→charge ≥ 40%;
first renewal ≥ 70%; refunds ≤ 5%; **any dispute is a stop**. Read only mature
denominators; under-five cells are "no data", and new users not yet eligible for
D3/week/renewal are **pending**, not failures. These are unmet today — the cohort
math (D2/D3, distinct-day repair) is the deferred MW-95-03 follow-up.

## Verdict & shortest path

- **Capped invite-only beta — CONDITIONAL GO**, unchanged from v15: freeze the v16
  candidate and **deploy** to a bounded cohort under the named accepted risk.
- **Public paid — NO-GO (7.9).** Shortest path: (1) freeze the candidate and run
  the immutable RC workflow; (2) run the authenticated E2E matrix at that SHA;
  (3) record the live-money rehearsal; (4) collect one mature value window against
  the hypotheses above. Only then re-score.

The single highest-value real-world action remains **marketing / traffic to
mellowa.app** — no score here changes that, and none of it is customer-facing.
