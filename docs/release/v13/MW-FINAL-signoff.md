# Mellowa v13 — launch sign-off (MW-FINAL)

> **SUPERSEDED (2026-08-04, MW-06).** Product code changed after RC `940cb94`
> (USD-first dual-currency pricing + EUR options, the readiness route, migration
> 042, and the branch-`v14` MW-02..MW-06 launch-hardening). This candidate no
> longer certifies HEAD, so **every verdict below is UNASSESSED** until MW-09
> cuts a new candidate. The verdicts in this document are the historical v13
> decision; the machine manifest (`manifest.v13.json`,
> `candidateLifecycle: "superseded"`) is the current truth.

**Candidate:** `940cb94a69a171a4174a06fa96bf60959b5d8542` (branch `launch/v13`,
lifecycle **superseded**) · **Baseline:** `74080e0` (v12) · **Date:** 2026-08-03.
Machine source of truth: [`docs/release/manifest.v13.json`](../manifest.v13.json),
validated by `tests/release-manifest.test.ts`. Where this human summary and the
manifest differ, the manifest is right.

## Executive verdict

| Tier | Verdict |
| --- | --- |
| Automated code gate | **CONDITIONAL GO** |
| Capped private beta (≤50 invites) | **CONDITIONAL GO** |
| Unrestricted public paid launch | **CONDITIONAL GO** |

`CONDITIONAL GO` is not `GO`. v13 **closed three P0s** (journal-reflection safety
lifecycle, Next.js advisories, release-truth contradictions) with candidate-pinned
green gates, and standardized the public metadata. What keeps public paid from a
clean `GO` is unchanged from v12: four owner-run blockers under standing accepted
risks, none of which Claude can or should discharge. **Capped beta is releasable**
once the owner runs the authenticated matrix once at this candidate; **public paid
scale** waits on the live rehearsal items.

The candidate stays **draft** until the owner runs the blocked items and freezes it.

## Gates re-run at `940cb94` (no production secrets)

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm run lint` | 0 errors, 2 pre-existing warnings | `evidence/v13/rc/lint.txt` |
| `npm run typecheck` | clean | `evidence/v13/rc/typecheck.txt` |
| `npx vitest run` | **1262 passed** (102 files) | `evidence/v13/rc/vitest.txt` |
| `npm run eval` | **81 passed** | `evidence/v13/rc/eval.txt` |
| `npm run build` | ✓ | `evidence/v13/rc/build.txt` |
| `npm run test:e2e:public` | **75 passed** (desktop/375/320) | `evidence/v13/rc/e2e-public.txt` |
| `npm audit --omit=dev` | **0 vulnerabilities** | `evidence/v13/rc/audit.txt` |
| authenticated E2E matrix | **BLOCKED** — seeded non-prod Supabase | `v13/MW-P1-05-status.md` |
| production release-check | **BLOCKED** — prod env, owner-run | `v13/MW-P1-06-owner-rehearsal.md` |
| cold-start + field vitals | **BLOCKED** — deployed preview + ≥100 samples | `v13/MW-P2-11-status.md` |

## What v13 changed (closed)

- **P0 · journal reflection** — output guard now runs with one corrective retry
  then fails closed; every reserved AI usage event reaches one terminal state
  (success / safety_blocked / provider_error finalize, or release); no journal
  text in the ledger. Proven by `tests/journal-reflection-route.test.ts` (9).
- **P0 · framework security** — Next 16.2.12 + sharp/postcss overrides; the
  audited proxy-bypass/DoS/SSRF advisories are resolved; production audit is 0
  vulnerabilities; `tests/protected-route-auth.test.ts` proves server-side auth
  independent of the proxy.
- **P0 · release truth** — one authoritative value per fact; a doc↔manifest
  consistency gate (`tests/release-truth-consistency.test.ts`) fails CI on any
  reintroduced contradiction (verified against an injected one).
- **P1 · public copy** — root metadata + PWA manifest standardized to the
  adaptive-day wedge; the generic planner line is gone and guarded by a contract test.

## Open risks (all owner-run; accepted risk stays visible, never closed)

| ID | Blocks | Owner | Mitigation / rollback | Accepted |
| --- | --- | --- | --- | --- |
| P0-LIVE-TRANSACTION | public_paid | Owner | steps 1–4 live 2026-08-01; steps 5–6 order-resilient in code + 2 tests; refundable by hand | 2026-08-01 |
| P1-AUTH-E2E-AT-HEAD | public_paid | Eng+Owner | fail-closed runner + marker-guarded seed; run once at v13, add a journal journey | 2026-07-28 |
| P1-REMINDER-REHEARSAL | public_paid | Owner | deterministic unit tests; blast radius = one email | 2026-07-28 |
| P1-ROTATION-RESTORE | public_paid | Owner | scripted drill; additive/re-runnable migrations; flag rollback | 2026-07-28 |
| P2-COLD-START / P2-INP-UNMEASURED | — | Eng | warm-lab baseline recorded; field owner-run | open |

Rollback is flag-based and data-safe (see manifest `rollback`); the Next patch +
overrides are drop-in and revertible via package.json + lockfile.

## First 72 hours (capped beta)

- **Daily owner review:** activation, adjust-commit failures, journal
  safety/finalization (`docs/runbooks/ai-usage-health-queries.sql` — stuck
  reservations must be zero), reminder failures, billing/webhooks, support,
  cancellations, performance.
- **Immediate stop/disable conditions:** any cross-user access, a foreign Stripe
  product granting entitlement, displayed price ≠ charged price, a paid user shown
  as Free or a duplicate checkout, any unsafe journal output returned, a claimed
  usage row left without a terminal state, or a high/critical reachable dependency
  advisory. Any of these → disable the affected surface via its flag and halt intake.
- **Cohort expansion** uses the predeclared `docs/beta-scorecard.md` thresholds
  and interviews — not a calendar promise.

## Owner checklist before freezing the v13 candidate

1. Run the authenticated matrix once at `940cb94` against a seeded non-prod
   Supabase + Stripe test mode; add a journal-reflection journey; attach artifacts
   under `evidence/v13/rc/`.
2. Run the read-only production release-check + verify-prices + secret-fingerprint.
3. Re-confirm the four accepted risks (or discharge any you can).
4. Flip `manifest.v13.json` `candidateLifecycle` to `frozen`, then deploy.

No live money, production migration, production account mutation, key rotation, or
fabricated evidence was performed in producing this candidate. Every BLOCKED item
above is a genuine missing prerequisite, not a hidden failure.
