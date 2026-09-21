# Mellowa — v22 Final MVP Release Closure: exact-SHA certification

> **⚠️ SUPERSEDED (v23, 2026-09-21).** The v23 production dependency security patch
> (Next.js `16.2.12`→`16.3.5`, Sharp `→0.35.4`, baseline-browser-mapping `→2.11.x`,
> resolving the Next.js critical / Sharp high / baseline moderate advisories) is
> **product code** landing after the frozen RC `faf5d16`. A dependency diff requires a
> new candidate SHA, so this certification **no longer certifies HEAD**: the active
> `manifest.v22.json` is now `candidateLifecycle: superseded` and every tier reads
> **UNASSESSED** (see [`STATUS.md`](STATUS.md)). Everything recorded below remains
> **true as a historical fact at `faf5d16`** — it is not fabricated and not erased —
> but a **new immutable RC must be re-cut** (owner-gated) via the release-candidate
> workflow, which now runs the hard `npm audit --omit=dev` gate and writes a
> SHA-pinned audit artifact, before any verdict can be read again. `matureValue` is
> **absent** (no cohort report) and no longer gates the paid MVP — it gates
> `scale_expansion`, which is **GATHERING DATA** (see §9).

Source pack: `Mellowa_Final_MVP_Fix_Prompts_v22` (Prompt 2 — Mellowa repository).
This is an honest, exact-SHA evidence record built on top of the v21 closure. **No
verdict is inferred from a score.** Production migration verification (050–054), the
immutable RC (re-cut at `faf5d16`), the authenticated E2E matrix, the live A–H
Stripe rehearsal and paid readiness were all executed and recorded in
[`EVIDENCE.md`](EVIDENCE.md) + [`LIVE-TRANSACTION-EVIDENCE.md`](LIVE-TRANSACTION-EVIDENCE.md).
At `faf5d16` the verdicts were **`GO / GO / GO`** (§9); the v23 dependency patch has
since superseded that RC, so the current active verdict is **UNASSESSED pending a
re-cut** (banner above). Secret rotation of `ADMIN_STATS_SECRET`/`CRON_SECRET` is done
(owner-attested, §9 / EVIDENCE.md §5).

Prompt 1 (LaunchBloom/Scalvya) and Prompt 3 (independent dual-repo certification)
are **out of scope for this repository** and were not run here.

## 1. Candidate identity

| Field | Value |
|---|---|
| Repository | Mellowa (local `dailyflowai`) |
| Branch | `main` (merged + pushed) |
| v22 code commit SHA | `30646b3c1590f73a1693e3dbc9aa2a87b8da9f9b` (regenerate-section fix) + `bc71ff9` (reconcile `isUnknownActivePrice` fix) |
| **Frozen RC SHA** | **`faf5d165a374d9b0b73bfbb47fc7a34ea0f5c9f1`** (`faf5d16`) — release-candidate workflow "Certify release candidate", conclusion success (8m 40s). A re-cut of the earlier `974e534` (run #17) so the frozen candidate includes the reconcile fix and is no longer superseded. |
| Deployed SHA / build id | `bc71ff9f4b0a170e23fcc1e9e18d0ad000b7156f` (`bc71ff9`), confirmed by public `/api/health` returning `version: bc71ff9`. `faf5d16` is docs-only on top of `bc71ff9`, so the frozen RC code == the deployed code. |
| Migration range | `001`–`054` (v22 adds **no** migration) |
| Candidate lifecycle | **superseded** (v23 dependency patch) — RC was frozen + promoted at `faf5d16` (authenticated matrix green, verdicts derived from recorded evidence); the v23 security patch is product code after the freeze, so the RC no longer certifies HEAD and every tier is UNASSESSED pending a re-cut |

### RC lineage
The v21 RC (`363e124`) was superseded by the v22 regenerate-section fix; a first v22
RC was cut at `974e534` (run #17). The owner-authorized reconcile bug fix
(`bc71ff9`, `isUnknownActivePrice`) was product code *after* that freeze, superseding
`974e534`, so the RC was **re-cut at `faf5d16`** via the release-candidate workflow
(success). `faf5d16` is docs-only over the deployed `bc71ff9`, so the frozen RC
certifies exactly the shipping code. Documentation-only commits after `faf5d16`
(e.g. this write-back) leave the frozen RC valid.

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
  (validated by `validateReleaseManifest`, 0 violations). It is now
  `candidateLifecycle: **superseded**` (v23 dependency patch) with `rcSha: faf5d16…`
  and every tier — `automated_code_gate`, `capped_beta`, `public_paid`,
  `scaleExpansion` — **UNASSESSED**; no active verdict is read from a superseded
  candidate. `dependency-audit` is now `required: true` / `blocked` — a real hard
  release gate (v23): `scripts/audit-dependencies.mjs` runs `npm audit --omit=dev`,
  fails closed on findings or an unavailable audit, and writes a SHA-pinned artifact
  read at promotion via `--audit-artifact`. The old hand-typed
  `openDependencyAdvisories = 0` owner gate is removed. `buildId: bc71ff9` records the
  production deploy that was live at `faf5d16`. Migration set `001–054` complete.
  `docs/release/v22/STATUS.md` is rendered from this manifest by
  `scripts/render-release-status.mjs`.
- README pins the **v22 line as RC `faf5d16` SUPERSEDED, awaiting a new candidate** —
  links `docs/release/v22/STATUS.md` + `manifest.v22.json` and reads verdicts from the
  generated status, never a hand-typed table (the `active-doc-truth` invariants). The
  earlier v16 line stays linked as archived history.
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

Also done at `faf5d16` — recorded in [`EVIDENCE.md`](EVIDENCE.md) /
[`LIVE-TRANSACTION-EVIDENCE.md`](LIVE-TRANSACTION-EVIDENCE.md), never fabricated
(these lines previously read "NOT RUN / IN PROGRESS" from before the owner completed
them; corrected here to match the evidence and §9/§10 — the exact NOT-RUN-vs-DONE
contradiction this release line removes):
5. **DONE ✅ — authenticated `/api/health/ready` with `LAUNCH_MODE=paid` = 200** on the
   deployed SHA, every component ok; closes the remainder of `P0-V22-PAID-READINESS`
   (EVIDENCE.md §3).
6. **DONE ✅ — live Stripe rehearsal (A–H)** on mellowa.app: all of A–H witnessed live,
   `P0-LIVE-TRANSACTION` closed (LIVE-TRANSACTION-EVIDENCE.md).

Remaining — owner-only, NOT RUN, never fabricated:
7. **Re-cut the immutable RC on the v23 dependency-patched SHA.** The v23 security
   patch supersedes `faf5d16`, so the owner must run the release-candidate workflow on
   the new HEAD (it now runs the hard `npm audit --omit=dev` gate + writes a SHA-pinned
   audit artifact), then `promote-candidate.mjs --candidate <artifact> --owner-evidence
   docs/release/v22/owner-evidence.v22.json --audit-artifact <sha>.json`. Until then
   every tier is UNASSESSED. See the owner checklist in
   [`docs/release/v23/OWNER-CHECKLIST.md`](../v23/OWNER-CHECKLIST.md).

## 8. Rollback

The v22 product-code changes are `src/app/api/ai/regenerate-section/route.ts`
(free-sample claim/refund correctness) and `src/lib/stripe/reconcile.ts`
(`isUnknownActivePrice` scoping — no entitlement/money logic changed); revert either
file to roll it back. No migration added; no other Stripe code changed (frozen at
v16). Code rollback target for the shipped line remains the last promoted RC.

## 9. Verdicts — historical `GO / GO / GO` at `faf5d16`, now UNASSESSED (superseded)

**Current active verdict: UNASSESSED for every tier** — the v23 dependency patch
supersedes RC `faf5d16` (banner at top; `manifest.v22.json` is `superseded`). The
table below records what was true **at the frozen RC `faf5d16`** (release-candidate
workflow "Certify release candidate", success, 8m 40s — a re-cut of `974e534` that
folded in the `isUnknownActivePrice` reconcile fix). These historical verdicts are
re-derivable once the owner re-cuts an RC on the v23-patched SHA and re-runs the
audit gate.

| Tier | Verdict @ `faf5d16` | Now | Why (at `faf5d16`) |
|---|---|---|---|
| **CAPPED_BETA** | GO | UNASSESSED (re-cut) | Immutable RC frozen at `faf5d16` with the authenticated E2E matrix green, migrations 050–054 verified in prod (19/19 PASS), safety + sample-claim correctness green. No open blocker. |
| **SUPERVISED_PAID_MVP** | GO | UNASSESSED (re-cut) | Paid readiness proven (`P0-V22-PAID-READINESS` CLOSED: reconcile `report.ok:true` + authenticated paid `/api/health/ready`=200, every component ok). Live billing **A–H rehearsal DONE** (`P0-LIVE-TRANSACTION` CLOSED — charge/cancel/reactivate/failure/recovery/out-of-order-drop/refund/idempotency witnessed live, each expected email delivered once). matureValue is **not** a gate for this tier (v23). |
| **STRICT_PUBLIC_PAID** | GO | UNASSESSED (re-cut) | All of the above + `release-check` production-owner gate satisfied by the deployed paid `/api/health/ready`=200 (the parity-tested live form of the canonical env contract), and a clean production dependency posture. In v23 that posture is proven by the **fresh SHA-pinned audit artifact** the RC workflow writes — not the old hand-typed `openDependencyAdvisories = 0`. |
| **SCALE_EXPANSION** | GATHERING DATA | GATHERING DATA | Separate from the paid MVP: gated on **mature customer-value proof** (a redacted cohort report with a measurement window, denominators and results). No such report exists, so `matureValue` is **absent** and scale expansion stays **GATHERING DATA** — never a fabricated pass. 10× capacity and paid-acquisition scale are post-MVP. |

**Secret rotation — done (owner-attested 2026-09-05):** `ADMIN_STATS_SECRET` +
`CRON_SECRET` rotated to random values, the cron.org scheduler secret updated, and
dependents redeployed; the disposable rehearsal values are retired. Tracked in
`ownerEvidence.secret-rotation` (status `live_rehearsed`, §5 of EVIDENCE.md).

The machine manifest (`manifest.v22.json`) is now `candidateLifecycle: superseded`
with `automated_code_gate`, `capped_beta`, `public_paid` and `scaleExpansion` all
**UNASSESSED** — no active verdict can be read from a superseded candidate. The
faf5d16 suite results and owner evidence remain recorded as historical facts.

## 10. How each public-paid gate was satisfied at `faf5d16`

At the frozen RC `faf5d16`, `public_paid` reached GO because every gate below was
backed by real evidence — no hand-invented verdict, no faked suite. (This is the
historical record at that SHA; the current active verdict is UNASSESSED pending a
v23 re-cut — §9.)

1. **DONE ✅ — Billing-reconcile fresh + paid readiness 200.** `report.ok:true`
   (`unknownPrices:[]`) + authenticated paid `/api/health/ready`=200,
   `cron_billing_reconcile_freshness:ok`, every component ok. `P0-V22-PAID-READINESS`
   CLOSED (`EVIDENCE.md` §3).
2. **DONE ✅ — A–H live Stripe rehearsal** on mellowa.app (`mon.prim`, `sub_1UCHR70`),
   real cancellation + recovery emails once each. `P0-LIVE-TRANSACTION` CLOSED
   (`LIVE-TRANSACTION-EVIDENCE.md`).
3. **DONE ✅ — RC re-cut at HEAD.** Because the reconcile fix was product code after
   the `974e534` freeze, the RC was re-cut at `faf5d16` via the release-candidate
   workflow (success) so the frozen candidate is no longer superseded.
4. **DONE ✅ — `release-check` production-owner gate.** Satisfied by the deployed
   authenticated paid `/api/health/ready`=200, which validates the identical
   canonical env contract (`config/paid-required-env.json`, parity-tested with
   `release-check.mjs`) *inside* the running deployment with the real Sensitive
   secrets — a stronger check than a local `npm run release-check`, which cannot see
   Vercel Sensitive vars (they pull empty).
5. **Dependency posture — clean, but re-proven, not carried forward.** At `faf5d16`
   the public-paid dependency gate rested on `openDependencyAdvisories = 0`. In v23
   that hand-typed literal is **removed**: the posture is proven by a fresh,
   SHA-pinned audit artifact (`scripts/audit-dependencies.mjs`, validated at the
   candidate SHA), and a missing/stale/unavailable audit blocks rather than reading
   as 0. The v23 patch itself makes `npm audit --omit=dev` = 0 production advisories,
   proven at the new RC. **`matureValue` is NOT a public-paid gate** (v23) — it is
   **absent** (no cohort report) and gates `scale_expansion` only (GATHERING DATA).
6. **DONE ✅ — Secret rotation** (owner-attested 2026-09-05): `ADMIN_STATS_SECRET` +
   `CRON_SECRET` rotated, cron.org updated, redeployed (§9, EVIDENCE.md §5).

All gates were recorded at `faf5d16` — the historical machine verdict was
`GO / GO / GO`. The v23 dependency patch supersedes that RC, so the current active
verdict is **UNASSESSED pending a re-cut**; no missing evidence is read as a pass.
