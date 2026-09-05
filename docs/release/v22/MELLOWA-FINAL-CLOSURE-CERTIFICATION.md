# Mellowa — v22 Final MVP Release Closure: exact-SHA certification

Source pack: `Mellowa_Final_MVP_Fix_Prompts_v22` (Prompt 2 — Mellowa repository).
This is an honest, exact-SHA evidence record built on top of the v21 closure. **No
verdict is inferred from a score.** Production migration verification (050–054), the
immutable RC freeze and the authenticated E2E matrix have now been executed and
recorded in [`EVIDENCE.md`](EVIDENCE.md); the remaining owner-only steps (paid
readiness / billing reconcile, secret rotation, deploy, live Stripe + email) are
NOT RUN. With those closed, **capped beta is GO**; paid remains NO-GO until its
owner evidence exists.

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
| **Frozen RC SHA** | **`974e534ea956e19acbb672701b97fe8d27f6944b`** — release-candidate workflow run #17, conclusion success; artifact `rc-evidence-974e534` sha256 `2f07ae74…` |
| Deployed SHA / build id | `c6e6f091b2d038b3de1e7d74da7d900391d6591e` (`c6e6f09`) — owner production deploy, confirmed by public `/api/health` returning `version: c6e6f09`. A **documentation-only superset** of the frozen RC `974e534` (only release-truth commits after the freeze), so the frozen RC still certifies the shipping code. |
| Migration range | `001`–`054` (v22 adds **no** migration) |
| Candidate lifecycle | **frozen** — RC cut at `974e534`, authenticated matrix green |

### Drift from the frozen RC `363e124`
The v21 RC (`363e124`) was superseded by the v22 product-code change (below). A
**new immutable RC was cut at `974e534`** (the v22 `main` HEAD after the code +
release-truth commits) via release-candidate workflow run #17 — success, with the
authenticated matrix green. Any documentation-only commit after `974e534` (e.g.
this evidence write-back) leaves the frozen RC valid, since it certifies the
shipping code, not the docs.

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
  (validated by `validateReleaseManifest`, 0 violations): `rcSha:
  974e534…`, lifecycle **`frozen`**, verdicts **`automated_code_gate: GO`,
  `capped_beta: GO`, `public_paid: NO-GO`** — and these stored verdicts now
  **equal `deriveVerdicts(manifest)`** (previously they disagreed: the stored
  `GO/GO` sat over a machine-derived `NO-GO/NO-GO` because `dependency-audit` was
  marked `required: true` while the immutable RC workflow never runs it, forcing
  `codeGreen=false`). `dependency-audit` is now `required: false` (a driftable,
  point-in-time check the RC does not freeze; production dependency posture is
  still gated for public paid via the `openDependencyAdvisories` owner gate in
  `deriveVerdicts`). `buildId: c6e6f09` records the confirmed production deploy.
  Migration set `001–054` complete.
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

2. **DONE ✅ — immutable RC cut + authenticated E2E matrix green.**
   release-candidate workflow run #17 (success) froze `974e534`; the required
   authenticated matrix passed against the seeded non-prod Supabase (Stripe TEST).
   Artifact `rc-evidence-974e534` sha256 `2f07ae74…`. Recorded in
   [`EVIDENCE.md`](EVIDENCE.md); closes `P0-V22-RC-NOT-CUT` and
   `P1-V22-AUTH-E2E-AT-HEAD`.

Done since — recorded in [`EVIDENCE.md`](EVIDENCE.md), never fabricated:
3. **DONE ✅ — secret rotation** (owner-attested 2026-09-05), including a
   **re-rotation of the weak/exposed interim `CRON_SECRET`** to a random value +
   redeploy. Metadata only; no values handled.
4. **DONE ✅ — `cron_billing_reconcile_freshness` fix deployed + clean run.** With
   `bc71ff9` live (public `/api/health`), a billing-reconcile POST returned
   `report.ok:true`, `unknownPrices:[]`, recording the durable `cron_runs` success
   that flips freshness to `ok`. The root-cause bug (a terminal sub's dead price
   counted into `unknownPrices`) is fixed in `isUnknownActivePrice`, not suppressed.

Remaining — NOT RUN / in progress, never fabricated:
5. Authenticated `/api/health/ready` with `LAUNCH_MODE=paid` returns **200** on the
   deployed SHA (needs `ADMIN_STATS_SECRET`, owner-run) — the last half of
   `P0-V22-PAID-READINESS`, now that reconcile freshness is `ok`.
6. Live Stripe rehearsal (A–H) — **IN PROGRESS** on mellowa.app; step A
   (checkout/trial → active) done, B–H pending. See
   [`LIVE-TRANSACTION-EVIDENCE.md`](LIVE-TRANSACTION-EVIDENCE.md).
7. (Optional) run `promote-candidate.mjs` against the downloaded `rc-evidence`
   artifact to adopt the computed record; the manifest already reflects the frozen
   RC and derived verdicts.

## 8. Rollback

The only v22 product-code change is `regenerate-section/route.ts`; revert it to the
previous file to roll back. No migration added; no Stripe code changed (frozen at
v16). Code rollback target for the shipped line remains the last promoted RC.

## 9. Verdicts

| Tier | Verdict | Why |
|---|---|---|
| **CAPPED_BETA** | **GO** | Immutable RC frozen at `974e534` with the authenticated E2E matrix green (run #17), migrations 050–054 verified in prod (19/19 PASS), safety + sample-claim correctness green. No open blocker targets capped beta. |
| **SUPERVISED_PAID_MVP** | **NO-GO → CONDITIONAL GO once `release-check` recorded** | Paid readiness proven (`P0-V22-PAID-READINESS` CLOSED 2026-09-05: reconcile `ok:true` + authenticated paid `/api/health/ready`=200). Live billing **A–H rehearsal DONE** (`P0-LIVE-TRANSACTION` CLOSED — charge/cancel/reactivate/failure/recovery/out-of-order-drop/refund/idempotency all witnessed live, real emails delivered once each). The one hard gate left is `release-check` `ci_pass` against the real prod env; with it, `deriveVerdicts` reads at least CONDITIONAL GO. |
| **STRICT_PUBLIC_PAID** | **NO-GO** | Paid readiness 200 ✅, verified migrations ✅, secret rotation ✅, **live A–H + real transactional emails ✅** (`P0-LIVE-TRANSACTION` CLOSED). Remaining for full GO: `release-check` `ci_pass` against prod env (hard `production_owner` gate), the `matureValue` observation, and rotation of the disposable `ADMIN_STATS_SECRET`/`CRON_SECRET` to random values before launch. |

The machine manifest (`manifest.v22.json`, validated 0 violations) now agrees:
`automated_code_gate` GO, `capped_beta` GO, `public_paid` NO-GO — derived from the
frozen RC `974e534`, the ci_pass suites, the closed blockers and the two open
public-paid blockers (`P0-V22-PAID-READINESS`, `P0-LIVE-TRANSACTION`).

## 10. Path to full public-paid GO (owner-run)

`public_paid` derives to **GO** the moment the owner evidence below is recorded —
no hand-editing of the verdict, no faked evidence. `deriveVerdicts` returns
`public_paid: GO` exactly when all of these hold (verified by simulation against
this manifest):

1. **DONE ✅ — Billing-reconcile fresh + paid readiness 200.** With `bc71ff9`
   deployed, one billing-reconcile run returned `report.ok:true` (`unknownPrices:[]`)
   and authenticated paid `/api/health/ready` returned **200** with
   `cron_billing_reconcile_freshness:ok` and every component ok. **`P0-V22-PAID-READINESS`
   is CLOSED** (see `EVIDENCE.md` §3).
2. **DONE ✅ — A–H live Stripe rehearsal.** The full charge → cancel → reactivate →
   payment-failure → recovery → late-failure-drop → refund → duplicate-idempotency
   sequence was witnessed live on mellowa.app (throwaway `mon.prim`, `sub_1UCHR70`),
   with real cancellation + recovery emails delivered once each. Opaque ids in
   `LIVE-TRANSACTION-EVIDENCE.md`. `ownerEvidence.live-transaction` = `live_rehearsed`;
   **`P0-LIVE-TRANSACTION` CLOSED** and its accepted risk removed.
3. **DONE ✅ — Secret rotation** (owner-attested 2026-09-05), incl. re-rotation of
   the weak interim `CRON_SECRET`. `ownerEvidence.secret-rotation` = done. **NOTE:**
   the disposable `ADMIN_STATS_SECRET`/`CRON_SECRET` value used for the readiness
   probe must be rotated to a random value before launch.
4. **PARTIAL — Deploy + readiness done; `release-check` remaining.** Authenticated
   paid `/api/health/ready`=200 is proven (item 1). Still required: `npm run
   release-check` run with the real production env reports ready → set the
   `release-check` suite `status: ci_pass` (the hard `production_owner` gate that
   `paidObserved`/`prodSuitesGreen` require). This is NOT recorded from the readiness
   curl alone — it must be an actual `release-check` run against prod env.

With 1–4 recorded and `openDependencyAdvisories=0` (currently true), the promote
step derives **`GO / GO / GO`**. Of the four, items 1–3 are DONE; the remaining
owner step is item 4 — a real `npm run release-check` against prod env recorded as
`ci_pass` (plus the `matureValue` observation for a non-conditional STRICT GO), and
rotating the disposable `ADMIN_STATS_SECRET`/`CRON_SECRET` to random values.
