# Mellowa — v22 Final MVP Release Closure: exact-SHA certification

> **⚠️ SUPERSEDED at `1b7dfef` (v24, 2026-09-22) — current verdict PENDING OWNER
> RECERTIFICATION, not GO.** The `GO / GO / GO` recorded below was certified at RC
> `1b7dfef83eec9570774254a8234f057c6e673a7b`, but that candidate is now superseded on
> two counts: (1) **deploy drift** — production `GET /api/health` serves `version:
> f0dbcf5`, not `1b7dfef`, so exact-SHA deploy parity is broken; and (2) the v24
> release-truth reconciliation adds new release-tooling commits past the frozen RC. No
> verdict can be read from a superseded candidate. Every launch tier is now
> **UNASSESSED** and strict public paid is **PENDING OWNER RECERTIFICATION** until the
> owner cuts a **new immutable RC at the v24 final SHA** and deploys exactly that SHA
> (see `docs/release/manifest.v22.json`, the generated `STATUS.md`, and blocker
> `P0-V24-DEPLOY-PARITY`). Everything recorded below is a **true historical record
> observed at `1b7dfef`** — the v23 dependency security patch (Next.js `16.3.5`, Sharp
> `0.35.4`, baseline-browser-mapping `2.11.x`), the green RC
> ([run 35657030867](https://github.com/primocera/Mellowa/actions/runs/35657030867)),
> the paid-readiness probe and the live A–H rehearsal — none of which certifies the
> current deploy. `matureValue` is **absent** and gates `scale_expansion`
> (GATHERING DATA), never the paid MVP.

Source pack: `Mellowa_Final_MVP_Fix_Prompts_v22` (Prompt 2) + `Nujne_MVP_Izboljsave_Mellowa_v23`.
This is an honest, exact-SHA evidence record. **No verdict is inferred from a score.**
Production migration verification (050–054), the immutable RC (now re-cut at
`1b7dfef`), the authenticated E2E matrix, the live A–H Stripe rehearsal (carried
forward — billing code unchanged) and paid readiness are all executed and recorded in
[`EVIDENCE.md`](EVIDENCE.md) + [`LIVE-TRANSACTION-EVIDENCE.md`](LIVE-TRANSACTION-EVIDENCE.md)
+ [`../v23/CERTIFICATION.md`](../v23/CERTIFICATION.md). Verdicts at `1b7dfef` are
**`GO / GO / GO`** (§9). Secret rotation of `ADMIN_STATS_SECRET`/`CRON_SECRET` is done
(owner-attested 2026-09-22, §9).

Prompt 1 (LaunchBloom/Scalvya) and Prompt 3 (independent dual-repo certification)
are **out of scope for this repository** and were not run here.

## 1. Candidate identity

| Field | Value |
|---|---|
| Repository | Mellowa (local `dailyflowai`) |
| Branch | `main` (merged + pushed) |
| v22 code commit SHA | `30646b3c1590f73a1693e3dbc9aa2a87b8da9f9b` (regenerate-section fix) + `bc71ff9` (reconcile `isUnknownActivePrice` fix) |
| **Frozen RC SHA** | **`1b7dfef83eec9570774254a8234f057c6e673a7b`** (`1b7dfef`) — release-candidate workflow [run 35657030867](https://github.com/primocera/Mellowa/actions/runs/35657030867), conclusion success. The v23 dependency-patch re-cut of `faf5d16`; this run adds the hard `npm audit --omit=dev` gate + SHA-pinned audit artifact. |
| Deployed SHA / build id | `1b7dfef83eec9570774254a8234f057c6e673a7b` (`1b7dfef`), confirmed by public `/api/health` returning `version: 1b7dfef` — the frozen RC code == the deployed code. |
| Migration range | `001`–`054` (v23 adds **no** migration) |
| Candidate lifecycle | **promoted** at `1b7dfef` — RC frozen green (audit gate + authenticated matrix), deployed, paid readiness re-probed 200/all-ok; verdicts derived from recorded evidence. Prior `faf5d16` RC was superseded by the v23 dependency patch and re-cut. |

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
  (validated by `validateReleaseManifest`, 0 violations): `candidateLifecycle:
  **promoted**`, `rcSha: 1b7dfef…`, verdicts `automated_code_gate`/`capped_beta`/
  `public_paid` = **GO** and `scaleExpansion` = **GATHERING DATA** — all derived, not
  hand-typed. `dependency-audit` is `required: true` / `ci_pass` with an `observedAtUtc`
  freshness instant — a real hard release gate (v23): `scripts/audit-dependencies.mjs`
  runs `npm audit --omit=dev`, fails closed on findings or an unavailable audit, and
  writes a SHA-pinned artifact read at promotion via `--audit-artifact`. The old
  hand-typed `openDependencyAdvisories = 0` owner gate is removed. `buildId: 1b7dfef`
  records the deployed build. Migration set `001–054` complete. `docs/release/v22/STATUS.md`
  is rendered from this manifest by `scripts/render-release-status.mjs`.
- README pins the **v22 line promoted at the v23-patched RC `1b7dfef`** — links
  `docs/release/v22/STATUS.md` + `manifest.v22.json` and reads verdicts from the
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

Done for v23 (dependency security patch) — 2026-09-22, never fabricated:
7. **DONE ✅ — immutable RC re-cut on the v23 dependency-patched SHA `1b7dfef`.**
   release-candidate workflow [run 35657030867](https://github.com/primocera/Mellowa/actions/runs/35657030867)
   (success) froze `1b7dfef` with the hard `npm audit --omit=dev` gate (0 production
   advisories) + SHA-pinned audit artifact and the required authenticated matrix green.
8. **DONE ✅ — deployed + paid readiness re-probed at `1b7dfef`.** Public `/api/health`
   → `version:1b7dfef`; authenticated `/api/health/ready` = 200, `mode:paid`, every
   component ok including `cron_billing_reconcile_freshness:ok` (billing-reconcile
   re-fired at `1b7dfef`, `report.ok:true`).
9. **DONE ✅ — secret re-rotation (2026-09-22).** The weak/exposed `ADMIN_STATS_SECRET`
   and `CRON_SECRET` were rotated to new values and redeployed; the new secrets
   authenticate readiness (200) and the reconcile cron (200). Metadata only.
   See the owner checklist [`docs/release/v23/OWNER-CHECKLIST.md`](../v23/OWNER-CHECKLIST.md)
   and certification [`docs/release/v23/CERTIFICATION.md`](../v23/CERTIFICATION.md).

## 8. Rollback

The v22 product-code changes are `src/app/api/ai/regenerate-section/route.ts`
(free-sample claim/refund correctness) and `src/lib/stripe/reconcile.ts`
(`isUnknownActivePrice` scoping — no entitlement/money logic changed); revert either
file to roll it back. No migration added; no other Stripe code changed (frozen at
v16). Code rollback target for the shipped line remains the last promoted RC.

## 9. Verdicts — HISTORICAL `GO / GO / GO` at `1b7dfef` (SUPERSEDED v24); scale expansion GATHERING DATA

**Superseded (v24).** The verdicts in the table below are the **historical** verdicts
that held **at RC `1b7dfef`** (release-candidate workflow
[run 35657030867](https://github.com/primocera/Mellowa/actions/runs/35657030867),
success — the v23 dependency-patch re-cut with the hard audit gate). They no longer
describe the current state: production `/api/health` serves `f0dbcf5` (deploy drift) and
v24 tooling commits move the tree past the frozen RC, so the **current** launch verdict
for every tier is **UNASSESSED / PENDING OWNER RECERTIFICATION** (see `manifest.v22.json`
and the generated `STATUS.md`). Scale expansion remains GATHERING DATA throughout.

| Tier | Verdict at `1b7dfef` (HISTORICAL — now SUPERSEDED) | Why |
|---|---|---|
| **CAPPED_BETA** | **GO** | Immutable RC frozen green at `1b7dfef` (authenticated E2E matrix green, migrations 050–054 verified, hard dependency-audit gate = 0 production advisories, safety + sample-claim correctness green). No open blocker. |
| **SUPERVISED_PAID_MVP** | **GO** | Paid readiness re-probed at `1b7dfef` (`P0-V22-PAID-READINESS` closed: authenticated `/api/health/ready`=200, `mode:paid`, every component ok incl `cron_billing_reconcile_freshness:ok` after re-firing reconcile). Live billing **A–H rehearsal** carries forward (`P0-LIVE-TRANSACTION` closed — witnessed live at faf5d16, each expected email delivered once; billing code byte-identical, so a dependency-only patch needs no re-run). matureValue is **not** a gate for this tier (v23). |
| **STRICT_PUBLIC_PAID** | **GO** | All of the above + `release-check` production-owner gate satisfied by the deployed paid `/api/health/ready`=200 at `1b7dfef` (the parity-tested live form of the canonical env contract), and a clean production dependency posture proven by the **fresh SHA-pinned audit artifact** the RC workflow wrote at `1b7dfef` — not a hand-typed `openDependencyAdvisories = 0`. |
| **SCALE_EXPANSION** | **GATHERING DATA** | Separate from the paid MVP: gated on **mature customer-value proof** (a redacted cohort report with a measurement window, denominators and results). No such report exists, so `matureValue` is **absent** and scale expansion stays **GATHERING DATA** — never a fabricated pass. 10× capacity and paid-acquisition scale are post-MVP. |

**Secret rotation — done (owner-attested 2026-09-22):** the weak/exposed
`ADMIN_STATS_SECRET` + `CRON_SECRET` rotated to new values and redeployed; the new
secrets authenticate readiness (200) and the reconcile cron (200). Metadata only.

The machine manifest (`manifest.v22.json`) is `candidateLifecycle: promoted` at
`1b7dfef` with `automated_code_gate`, `capped_beta`, `public_paid` = **GO** and
`scaleExpansion` = **GATHERING DATA** — verdicts derived from the recorded evidence,
never hand-typed.

## 10. How each public-paid gate was satisfied at `1b7dfef`

At the promoted RC `1b7dfef`, `public_paid` reached GO because every gate below is
backed by real evidence — no hand-invented verdict, no faked suite.

1. **DONE ✅ — Billing-reconcile fresh + paid readiness 200.** `report.ok:true`
   (`unknownPrices:[]`) + authenticated paid `/api/health/ready`=200,
   `cron_billing_reconcile_freshness:ok`, every component ok. `P0-V22-PAID-READINESS`
   CLOSED (`EVIDENCE.md` §3).
2. **DONE ✅ — A–H live Stripe rehearsal** on mellowa.app (`mon.prim`, `sub_1UCHR70`),
   real cancellation + recovery emails once each. `P0-LIVE-TRANSACTION` CLOSED
   (`LIVE-TRANSACTION-EVIDENCE.md`).
3. **DONE ✅ — RC re-cut at HEAD (`1b7dfef`).** Because the v23 dependency security
   patch is product code, the RC was re-cut at `1b7dfef` via the release-candidate
   workflow ([run 35657030867](https://github.com/primocera/Mellowa/actions/runs/35657030867),
   success) — now including the hard `npm audit --omit=dev` gate — and deployed.
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
6. **DONE ✅ — Secret rotation** (owner-attested 2026-09-22): the weak/exposed
   `ADMIN_STATS_SECRET` + `CRON_SECRET` rotated to new values, redeployed; new secrets
   authenticate readiness (200) and the reconcile cron (200) (§9).

All gates are backed by real evidence at `1b7dfef` — the machine verdict is
`GO / GO / GO`, with scale expansion held at GATHERING DATA (no cohort report). No
missing evidence is read as a pass.
