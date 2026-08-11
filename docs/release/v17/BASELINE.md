# V17 Post-Audit Closure — Truth-Freeze Baseline (MW-V17-00)

**Branch:** `v17` · **Cut from:** `main` @ `0bfc7048ca6013b517779a8cb6c40800e2d10bf4` (== audited snapshot, == `origin/main`; zero drift)
**Established:** 2026-08-11

This is the MW-V17-00 deliverable: one evidence-backed baseline on the real current SHA,
classifying every downstream v17 gap as **OPEN / PARTIALLY CLOSED / ALREADY CLOSED / OWNER-GATED**
against live source — *not* against historical gap registers. Already-closed work is proved, not rebuilt.

## Observed starting point — verified

| Claim (from pack) | Verification at HEAD | Result |
|---|---|---|
| typecheck clean | `npm run typecheck` → tsc no errors | ✅ confirmed |
| release-manifest 86/86 | `npm run release-manifest` → 86 passed | ✅ confirmed |
| full unit suite ~1500 | `npm test` → 122 files, 1500 passed / 0 failed | ✅ confirmed (1500/1500) |
| nanoid high advisory | `npm audit --omit=dev` → 1 high (`nanoid: custom generators loop when size 0`) | ✅ confirmed OPEN |
| manifest.v16 draft/UNASSESSED | `docs/release/manifest.v16.json` rcSha:null, lifecycle:"draft", verdicts UNASSESSED | ✅ confirmed |
| RC env contract broken | workflow vs runner env names diverge (see MW-01) | ✅ confirmed OPEN |

Note: `manifest.v16.json.baselineSha` = `432ed18…` (v15) is itself **stale vs current HEAD** `0bfc704…` — an
additional drift signal folded into MW-V17-02.

## Downstream gap classification

| ID | Area | Classification | Evidence (file:line) | Touches billing? |
|---|---|---|---|---|
| MW-V17-01 | RC auth-E2E env contract | **OPEN** | workflow exports `E2E_TEST_USER_EMAIL`/`E2E_STRIPE_SECRET_KEY`/`E2E_SUPABASE_URL`; runner requires `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`/`E2E_SUPABASE_TEST=1`/`STRIPE_SECRET_KEY` → names never match → BLOCKED (RC) | No (CI/workflow) |
| MW-V17-02 | RC lifecycle / manifest | **OPEN** | `manifest.v16.json:5-6` rcSha:null, lifecycle:draft; `:122-124` verdicts UNASSESSED; baselineSha stale | No (release tooling) |
| MW-V17-03 | Check-in sensitive storage | **OPEN** | `checkin-form.tsx:85,203` full draft persisted to `localStorage` under `mellowa_checkin_draft` | No (privacy) |
| MW-V17-04 | Deletion transactionality | **OPEN** | `account/delete/route.ts:84-94` email + `:97` `trackEvent('account_deleted')` fire **before** `:100` `deleteUser`; `:62` cancels by local `stripe_subscription_id` with **no** `metadata.app=mellowa` ownership check | **YES — Stripe cancel** |
| MW-V17-05 | Portal fail-closed | **PARTIALLY OPEN** | `stripe/portal/route.ts:40` destructures only `data`, ignores query `error` → DB outage falls to `:46 no_customer` instead of retryable `billing_unavailable`. Ownership check (MW-95-01) already present `:53-72` | **YES — Stripe portal** |
| MW-V17-06 | Onboarding durability/resume | **PARTIALLY CLOSED** | `onboarding/complete/route.ts` already server-authoritative + fail-closed reads (`:31-54`); still check-then-act (concurrency race) + `trackEvent` not awaited (`:56`); wizard step-index resume unverified | No |
| MW-V17-07 | Recurring-value scorecard | **OPEN (partial, ex-MW-95-03)** | analytics scorecard rows still deferred per active docs; large | Reads billing events |
| MW-V17-08 | nanoid advisory | **OPEN** | `npm audit --omit=dev` → 1 high via next→postcss@8.5.25→nanoid@3.3.16 (patched ≥3.3.17) | No (dependency) |
| MW-V17-09 | Release-truth / support SLA | **OPEN** | README mixes v12/v13/v16, claims closed loop + 0 vulns while manifest draft & 1 high open; Help/Settings promise 2-business-day paid support | No (docs) |
| MW-V17-10 | Freeze + re-score | **OWNER-GATED** | final candidate cut; depends on 01–09 | No (produces validators only) |
| XAPP-V17-01 | Stripe isolation proof | **LIKELY PARTIALLY CLOSED** | v15 shipped XAPP-01 app-namespace isolation; needs symmetric proof + peer repo | **YES — Stripe** + needs LaunchBloom repo |
| XAPP-V17-02 | Two-product launch verdict | **OWNER-GATED / cross-repo** | read/verify/decision; needs LaunchBloom repo | No (decision) |

## Frozen prior constraint (owner memory) — must reconcile before billing edits

Project memory records: **Stripe/billing FROZEN at v16** — owner accepted `P0-LIVE-TRANSACTION`
(carry-forward in `manifest.v16.json.acceptedRisks`); directive: do NOT re-open the live gate or change
Stripe code in new packs. Confirmed present at `manifest.v16.json:112-120`.

Three v17 prompts edit Stripe code: **MW-V17-04**, **MW-V17-05**, **XAPP-V17-01**. None re-open the live
gate or alter charge/checkout semantics — they are fail-closed **failure-path correctness** fixes
(a DB-error path returning a false `no_customer`; email/analytics firing before a possibly-failed delete;
cancel without ownership proof on a shared account). Whether these fall inside or outside the freeze is an
**owner decision**, recorded here pending confirmation.

## External / owner-only (never closable by Claude)

- Authenticated E2E at frozen candidate SHA (non-prod) — validator prepared, run owner-observed.
- Deployed readiness (`GET /api/admin/readiness`) — owner-observed.
- Live money lifecycle — owner-observed; residual formally accepted (`P0-LIVE`).
- Real cohort (D2/D3, repair, Week, renewal) — owner-observed, maturity-gated.

## Rules carried into every v17 prompt

- No test count substitutes for auth/live/value evidence.
- Blocked/skipped/not-run is never PASS; no score raised, no candidate frozen, no evidence invented.
- Every implementation prompt must point to a confirmed OPEN/PARTIAL gap above.
