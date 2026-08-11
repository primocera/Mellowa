# MW-V17-10 — Freeze, safe gates, and honest re-score

**Branch:** `v17` · **HEAD at this record:** `4e7e19d` · Established 2026-08-11.

This closes the v17 technical pack. It records the safe local gates, the honest
re-score, and the **owner-run** sequence that remains — none of which Claude may
execute. **No candidate is frozen here** (a frozen candidate requires the owner
to dispatch the immutable RC workflow, provenance `workflow`); the tracked
`manifest.v16.json` stays `draft`, which is the truthful state.

## Safe local gates (re-run at HEAD `4e7e19d`)

| Gate | Command | Result |
|---|---|---|
| Deterministic install | `npm ci` | ok |
| Prod dependency audit | `npm audit --omit=dev` | **0** high/critical (one dev-only js-yaml, tracked) |
| Lint | `npm run lint` | clean |
| Typecheck | `npm run typecheck` | clean |
| Unit/contract/safety | `npm test` | **1562 / 1562** |
| Eval gate | `npm run eval` | **81 / 81** |
| Production build | `npm run build` | **73** pages, ✓ compiled |
| Release manifest | `npm run release-manifest` | **86 / 86** |
| Status render sync | `render-release-status … --check` | in sync |
| Freeze mechanism | `freeze-candidate.mjs` (local dry-run) | code=GO, beta=NO-GO, paid=NO-GO (honest) |

A blocked/skipped/not-run check is BLOCKED/NOT RUN, never PASS.

**Authenticated E2E matrix — already owner-run, but SUPERSEDED at v17.** The owner
ran it at committed SHA `a59aa4e`: **93 passed / 0 failed / 27 skipped** (120
total, mode `rc`), against a disposable marker-gated non-production Supabase in
Stripe TEST mode — recorded as `local_pass` in `manifest.v16.json.ownerEvidence`
and closing `P1-AUTH-E2E-AT-HEAD` in `closedBlockers`
(`docs/release/evidence/v13/auth-matrix/a59aa4e….json`). Two caveats keep it from
certifying the v17 candidate: (1) it was a local owner-run, not a workflow-frozen
RC; (2) current v17 HEAD has drifted past `a59aa4e` (all 12 v17 changes), so the
evidence is superseded and must be **re-run at the frozen v17 SHA**. It was not
re-runnable in this session (no seeded non-prod env here) — that is a session
limitation, not "never run."

## Honest re-score (non-compensating; blocker caps applied before scoring)

Technical quality and market/observed evidence are **not** averaged. The record
is `draft`, so no tier carries an active verdict until the owner freezes.

| Tier | Score | Verdict | Why capped |
|---|---|---|---|
| Product capability | ~9.0 | high | Code contracts green (1562/1562, eval 81, build 73, prod audit 0). Not a beta/paid readiness claim. |
| Capped beta | ≤ 8.9 | UNASSESSED (→ CONDITIONAL GO once frozen + authed journeys re-observed) | No frozen candidate; the authenticated matrix passed at `a59aa4e` (93/0/27) but is superseded by v17 drift — re-run required at the frozen v17 SHA. |
| Public paid | 7.9 | NO-GO (owner-accepted P0 carry-forward → CONDITIONAL for a bounded launch) | Open `P0-LIVE-TRANSACTION` caps below 8; live-money lifecycle, deployed readiness and mature cohort all unobserved. |

No 9.5 is assigned: it requires predeclared gates all observed, not documentation
volume or test count.

## Owner-run sequence — each is NOT RUN until the owner performs it

1. **Freeze** (RC workflow): `gh workflow run release-candidate.yml -f candidate_sha=<HEAD>`
   → produces `candidate/<sha>.json` (provenance `workflow`). See `RC-LIFECYCLE.md`.
   Fails closed on missing seeded secrets / non-test Stripe key / zero auth tests. — **NOT RUN**
2. **Authenticated E2E matrix** — previously owner-run at `a59aa4e` (93/0/27);
   **RE-RUN required at the frozen v17 SHA** (product code drifted), seeded
   non-prod Supabase + Stripe TEST (`npm run test:e2e:matrix`, canonical env per
   `MW-V17-01`). — **NOT RUN at the v17 candidate**
3. **Deployed readiness**: `GET /api/admin/readiness` → `ready=true`, `blockers=0`, exact deploy SHA. — **NOT RUN**
4. **Live-money lifecycle** (real low-value): charge/trial, entitlement, cancel/portal, failure→recovery,
   late/out-of-order, refund. Residual formally accepted (`P0-LIVE`, carry-forward) — do NOT re-open;
   re-verify one completed current-code live charge before scaling. — **NOT RUN**
5. **Cohort**: bounded adult cohort → D2/D3 + repair + Week + first renewal, per
   `COHORT-METRIC-DICTIONARY.md`; mature denominators, predeclared rules. — **NOT RUN**
6. **Operations**: monitoring, safety/billing rollback, support owner, kill switch. — **NOT RUN**

## Freeze invariant

Once a candidate is frozen/promoted, no runtime/source/migration/workflow/config
change is allowed without cutting a NEW candidate and re-running the affected
evidence. Rollback is flag-based and data-safe; every v17 migration (043) is
additive; code rollback target is in `manifest.rollback`.
