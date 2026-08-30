# Mellowa — v22 Final MVP Release Closure: exact-SHA certification

Source pack: `Mellowa_Final_MVP_Fix_Prompts_v22` (Prompt 2 — Mellowa repository).
This is an honest, exact-SHA evidence record built on top of the v21 closure. **No
verdict is inferred from a score.** One owner-only step — production migration
verification (050–054) — has now been executed and recorded in
[`EVIDENCE.md`](EVIDENCE.md); every other owner-only step remains NOT RUN. A
truthful CONDITIONAL GO / NO-GO with incomplete owner evidence is the correct
result at this stage.

Prompt 1 (LaunchBloom/Scalvya) and Prompt 3 (independent dual-repo certification)
are **out of scope for this repository** and were not run here.

## 1. Candidate identity

| Field | Value |
|---|---|
| Repository | Mellowa (local `dailyflowai`) |
| Branch | `v22` (not merged, not pushed) |
| Audited base / starting SHA | `73f2b830354cb060296e47775fbba479f84b177a` (HEAD matched the pack baseline exactly — no drift) |
| Frozen RC baseline (v21) | `363e124cd1f18f30d2a30b1c64dc346e4687b904` |
| v22 code commit SHA | `30646b3c1590f73a1693e3dbc9aa2a87b8da9f9b` |
| RC / candidate SHA | none — **no immutable RC cut** (owner/CI gate) |
| Deployed SHA / build id | none — **not deployed by this work** |
| Migration range | `001`–`054` (v22 adds **no** migration) |
| Candidate lifecycle | **draft** — nothing frozen |

### Drift from the frozen RC `363e124`
The v21 RC was frozen at `363e124`. Since then, `main` advanced to `73f2b83`
through owner/docs commits (`201794d`, `35a4fb0`, `73f2b83`) — including one
readiness code fix (`35a4fb0`, probe `analytics_excluded_users` by its real PK).
v22 then adds one product-code change on top (below). Because product code has
moved past `363e124`, that RC is **superseded**; a new RC must be cut at the v22
SHA before any tier can carry an active verdict.

## 2. Change scope (owner-named gap only, built on top)

`git diff --stat` (v22 product + test change vs `main`):

- `src/app/api/ai/regenerate-section/route.ts` — free-sample claim/refund correctness.
- `tests/regenerate-section-fail-closed.test.ts` — one assertion updated for the new claim ordering.
- `tests/regenerate-section-sample-claim.test.ts` — **new** dedicated correctness suite (7 cases).
- `docs/release/manifest.v22.json`, `docs/release/v22/…`, `README.md` — release-truth reconciliation.

**Preserved unchanged (already implemented — not re-done):** WS-A fail-closed
required-context reads (plan-repair + regenerate-section), WS-B bounded provider
lease under the daily-plan claim lease, WS-C canonical `LAUNCH_MODE` (health.ts,
release-check, `.env.example`). No Stripe/billing code changed (frozen at v16).

## 3. Free-sample claim / refund — root cause and fix

**Root cause (two real bugs in `regenerate-section`).**
1. The one-lifetime claim was a conditional `UPDATE … WHERE sample_adjustment_used_at
   IS NULL` whose result captured only `{ data: claimed }` and **ignored `error`**.
   On a claim RPC **database error**, `claimed` is null, so the route returned
   `402 sample_adjustment_used` — i.e. a transient DB outage was reported to the
   user as *"you have already used your free sample."* Fail-open on a safety/
   entitlement read.
2. `refundSampleAdjustment` issued the compensating `UPDATE … = null` and **ignored
   its error**. A failed refund was silent: the response still said "nothing was
   changed" while the lifetime allowance stayed consumed.

**Fix (smallest production-safe change, existing schema, no new migration).**
- The claim now captures `{ data, error }`. A **claim RPC error → `503
  data_unavailable`**, calls no provider and consumes no entitlement (never `402`).
- The atomic claim is **moved to just after every fail-closed read and validation,
  immediately before the only mutation**. Consequence: no failed read can happen
  *after* a claim, so the compensation surface collapses to a **single path**
  (the curated save). Every pre-claim failure returns before any claim exists —
  its "nothing was changed" message is always true.
- Compensation is **verified and idempotent**: the refund captures its error; if the
  refund cannot be confirmed the route logs an operational breadcrumb (`userId`,
  `eventId`, `section` — no plan content) and returns an explicit **repairable
  state** (`sample_claim_unresolved`, `repairable: true`) instead of "nothing
  changed". Re-clearing an already-null timestamp is a no-op, so a client retry
  after an ambiguous save never grants extra allowance.

## 4. Safety regression proof

The already-closed WS-A behaviour is retained and proven by
`tests/regenerate-section-fail-closed.test.ts` (plan/profile read error → 503, no
provider, reservation released; verified-absent profile → 400). The new
`tests/regenerate-section-sample-claim.test.ts` proves:

| Case | Expected |
|---|---|
| claim RPC error | `503 data_unavailable`, **not** `sample_adjustment_used`; no provider; reservation released; nothing claimed |
| claim already used (verified no-row) | `402 sample_adjustment_used`; no provider |
| curated save failure after a claim | allowance refunded; `500 Failed to save section` |
| refund **also** fails | `500 sample_claim_unresolved`, `repairable: true` — never "nothing changed" |
| meal_card for a sample user | `402 premium_required` **before** any claim (allowance untouched) |
| happy path | `200`, `sample_adjustment: true`, exactly one claim, no refund, no provider |
| retry after an ambiguous save | refund returns the allowance; a fresh retry can claim again; never extra allowance |

No plan/completion/profile/timezone read error can reach an AI provider or mutate a
plan; allergies and movement restrictions are never replaced by empty values after a
failed read (WS-A, unchanged).

## 5. Commands and results (local, at the v22 baseline)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **PASS** (tsc --noEmit, no errors) |
| Lint | `npm run lint` | **PASS** (eslint exit 0) |
| Unit/contract/safety | `npx vitest run` | **2186 passed / 2 failed** — the 2 failures are pre-existing byte-for-byte render-drift on the historical v16 STATUS page (`release-v16.test.ts`, `mw08-release-candidate.test.ts`), present since v21 and unrelated to v22 (v22 added 7 passing tests: 2179 → 2186) |
| Production build | `npm run build` | **PASS** (next build, exit 0) |
| Prod dependency audit | `npm audit --omit=dev` | **0 vulnerabilities** |

The 2 pre-existing failures are trailing-whitespace drift on a **historical**
manifest's rendered page. Under the "historical manifests remain immutable" rule
they were left untouched; they are recorded here honestly rather than papered over.

## 6. Release-truth reconciliation

- `docs/release/manifest.v22.json` is the authoritative **current** machine record
  (validated by `validateReleaseManifest`, 0 violations): `rcSha: null`,
  lifecycle `draft`, all three verdicts `UNASSESSED`, owner evidence `not_run`,
  migration set `001–054` complete.
- README continues to link the last **generated/promoted** status
  (`docs/release/v16/STATUS.md` + `manifest.v16.json`) — an intentional, tested
  invariant (`active-doc-truth`, `release-truth-consistency`): README defers to the
  last rendered status and cannot present a hard-coded GO. A v22 pointer line was
  added to the Release status section so the current record is discoverable without
  breaking that deferral.
- Historical manifests (v11/v13/v16/v20) are unchanged and clearly historical.

## 7. Owner-only steps

1. **DONE ✅ — production migrations `050–054` verified.** Owner ran
   `scripts/verify-migrations-050-054.sql` in the prod Supabase SQL editor on
   2026-08-30: **19/19 PASS, 0 FAIL**, including `readiness_schema_probe` = all
   invariants true. Recorded in [`EVIDENCE.md`](EVIDENCE.md); closes
   `P0-V22-MIGRATIONS-APPLIED`.

Remaining — NOT RUN, never fabricated:
2. Rotate previously-reported-exposed credentials (DB creds, disposable keys,
   `CRON_SECRET`, `ADMIN_STATS_SECRET`) and redeploy dependents, per
   `docs/runbooks/key-rotation-and-backup.md`. **NOT VERIFIED** — no values handled.
3. Resolve `cron_billing_reconcile_freshness=unavailable`: configure the external
   billing-reconcile pinger and record a durable success in `cron_runs` (resolving
   the owner legacy-price subscription if it blocks a clean reconcile). Not
   suppressed or special-cased in code.
4. Cut an immutable RC at the v22 SHA (`release-candidate.yml`), run the authenticated
   E2E matrix on that SHA, then `promote-candidate`.
5. Deploy the candidate; verify `/api/health` returns that exact version and
   authenticated `/api/health/ready` with `LAUNCH_MODE=paid` returns 200.
6. Live Stripe rehearsal (charge/cancel/reactivate/recovery/refund) and one real
   transactional email with replay idempotency.

## 8. Rollback

The only v22 product-code change is `regenerate-section/route.ts`; revert it to the
previous file to roll back. No migration added; no Stripe code changed (frozen at
v16). Code rollback target for the shipped line remains the last promoted RC.

## 9. Verdicts

| Tier | Verdict | Why |
|---|---|---|
| **CAPPED_BETA** | **CONDITIONAL GO** | Core authenticated journey, data ownership, safety, build and the sample-claim correctness fix are green locally; migrations 050–054 are **verified in prod** (2026-08-30, 19/19 PASS — [`EVIDENCE.md`](EVIDENCE.md)). Remaining condition: cut an RC at the v22 SHA and observe the authenticated E2E matrix (or record an owner-accepted risk). |
| **SUPERVISED_PAID_MVP** | **NO-GO** (until owner evidence) | Blocked by `cron_billing_reconcile_freshness=unavailable` (paid readiness not 200) and no live-billing monitoring/recovery evidence. Closes when reconcile is fresh + readiness 200 on the deployed SHA. |
| **STRICT_PUBLIC_PAID** | **NO-GO** | Exact-SHA RC, paid readiness 200, verified migrations, live billing + one real transactional email, and secret-rotation evidence are all owner-gated and NOT RUN. `P0-LIVE-TRANSACTION` remains an owner-accepted risk from v16. |

The machine manifest reads `UNASSESSED` for every tier — the honest state when no
candidate is frozen — while these human verdicts state the conditional path. They do
not contradict: `UNASSESSED` = "no frozen candidate to read a verdict from yet."
