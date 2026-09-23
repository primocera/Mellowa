# Mellowa v24 — release-truth reconciliation (Prompt 2)

Scope: **release automation + evidentiary truth only.** No product, billing,
entitlement, webhook, AI-safety or data-logic change; no new feature, tier,
generator or migration. Built on top of the existing v22/v23 machinery — nothing
already implemented was re-scaffolded.

## Why v24 exists

The active release record was `docs/release/manifest.v22.json`, but the RC tooling
disagreed with it, and the promoted verdict no longer matched production:

1. **Split active path.** `freeze-candidate`, `promote-candidate`, the
   release-candidate workflow's status render-check and its evidence upload, and the
   `render-release-status` npm script all still hard-coded the **archived**
   `docs/release/manifest.v16.json` — which does not even carry the v23
   `dependency-audit` suite. A freeze/promote/upload could therefore run against a
   stale manifest.
2. **Deploy drift.** The manifest + certifications claimed `public_paid GO`, deployed
   at `1b7dfef`, while production `GET /api/health` returns **`f0dbcf5`**. Exact-SHA
   deploy parity was broken.
3. **Owner-evidence contradiction.** `docs/release/v23/OWNER-CHECKLIST.md` claimed all
   owner steps were executed, while every row of its evidence table read `NOT RUN`.

## What changed (WS-A / WS-B / WS-C / WS-D)

### WS-A — one canonical active-manifest path
- New `scripts/active-manifest.mjs` exports the single source of truth:
  `ACTIVE_MANIFEST_PATH = docs/release/manifest.v22.json`,
  `ACTIVE_STATUS_PATH = docs/release/v22/STATUS.md`, and the archived set.
- **Consumers repointed v16 → v22** (and now import the constant, no hard-coded path):
  `scripts/freeze-candidate.mjs`, `scripts/promote-candidate.mjs`,
  `.github/workflows/release-candidate.yml` (status render-check **and** evidence
  upload), and the `render-release-status` script in `package.json`.
- `freeze-candidate` / `promote-candidate` accept an explicit `--manifest`; the freeze
  refuses a manifest with no required `dependency-audit` suite; `promote` records the
  source manifest in the proposal's `promotedFrom` provenance.
- **Contract test** `tests/active-manifest-path.test.ts` fails if any active consumer
  points back at v16 or if the paths disagree.

### Removed active v16 references vs intentionally-kept historical
- **Removed (were active):** freeze default, promote default, workflow render-check,
  workflow evidence upload (manifest + STATUS), `package.json` render script.
- **Kept (intentionally historical / archived):** `docs/release/manifest.v16.json` +
  `docs/release/v16/STATUS.md` (README archived-history links; `tests/release-v16.test.ts`,
  `tests/scope-notes-truth.test.ts`, `tests/mw01-rc-runbook.test.ts`,
  `tests/readiness-score.test.ts` read v16 strictly as an archived snapshot). These do
  not influence the current RC verdict.

### WS-B — deploy / exact-SHA lifecycle
- `manifest.v22.json` is now `candidateLifecycle: superseded` with a `supersededNote`,
  `productHeadSha: f0dbcf5`, every launch tier **UNASSESSED**, and a new open blocker
  `P0-V24-DEPLOY-PARITY`. Scale expansion stays **GATHERING DATA** (a superseded
  candidate may carry it — it is not a decision to ship).
- The v22 `STATUS.md` was re-rendered from the manifest; the v22 FINAL-CLOSURE
  certification and the v23 certification were reconciled so their `GO` claims read as
  **historical at `1b7dfef`, SUPERSEDED**, not current.
- **A later commit must never silently become a new production deploy without an RC**
  (that is exactly how `f0dbcf5` drifted past `1b7dfef`). Allowed solution documented
  below.

### WS-C — owner evidence truth
- `docs/release/v23/OWNER-CHECKLIST.md` no longer claims "all owner steps executed"; its
  all-`NOT RUN` table is marked **TEMPLATE HISTORY** (the procedure, not proof). The
  authoritative recorded outcomes live in `docs/release/v23/CERTIFICATION.md`.

### WS-D — release-truth tests
- `tests/release-truth-v24.test.ts` enforces the six v24 fail-conditions; the v22
  assertion block in `tests/dependency-audit-gate.test.ts` was updated from
  promoted/GO to superseded/UNASSESSED.

## Preventing a docs-only commit from auto-deploying without an RC (WS-B.4)

**Chosen policy — Ignored Build Step gated on the changed paths, plus manual
promotion of the exact RC SHA. It never hides runtime drift.**

1. **Docs-only commits do not deploy.** Configure the Vercel project's *Ignored Build
   Step* so a build is **skipped** when a push changes only non-runtime paths
   (`docs/**`, `*.md`, `README.md`). Concretely, the ignore command exits 0 (skip
   build) only if no runtime path changed:

   ```bash
   # Vercel "Ignored Build Step" — build ONLY when a runtime path changed.
   # Exit 1 = build; exit 0 = skip. Never skips when runtime code moved.
   git diff --name-only "$VERCEL_GIT_PREVIOUS_SHA" HEAD \
     | grep -Eqv '^(docs/|README\.md$|.*\.md$)' && exit 1 || exit 0
   ```

   Because the guard **builds** whenever anything outside docs changed, a runtime diff
   can never be silently skipped — it is not a way to hide code drift.

2. **Runtime changes go through the RC workflow + manual promotion.** Any runtime change
   is certified by the immutable `release-candidate` workflow at its exact 40-char SHA,
   and that **same** SHA is deployed by promoting the exact build (Vercel: *Promote to
   Production* on the build for that commit) — not by auto-deploying whatever landed on
   `main` afterwards.

3. **Alternative (equivalent) allowed forms:** pin the RC as an external GitHub Release
   artifact and deploy strictly from it; or keep evidence-only write-backs on a
   non-deploying `evidence/*` branch. All three keep `suites.sha == rcSha == buildId ==
   deployed /api/health version` after the owner's final step.

## Owner handoff — the new final SHA (feeds Prompt 3)

Because these release-tooling commits create a new SHA, **the v24 branch HEAD (after
commit) is the new candidate**; `f0dbcf5` must not be certified as final. The owner
sequence to restore parity (owner-only — Claude runs none of it):

1. Merge `v24` to `main`; note the exact 40-char **FINAL SHA**.
2. Run the `release-candidate` workflow at FINAL SHA (hard audit gate + authenticated
   matrix must be green; freeze the immutable candidate).
3. Deploy exactly FINAL SHA; confirm public `/api/health` returns its short SHA.
4. Authenticated `/api/health/ready` in `LAUNCH_MODE=paid` = 200, all paid-critical
   components ok (incl. `cron_billing_reconcile_freshness`).
5. Promote the frozen candidate; `manifest.v22.json` lifecycle returns to `promoted`
   with `rcSha == buildId == productHeadSha == deployed version == FINAL SHA`, closing
   `P0-V24-DEPLOY-PARITY`.
6. Live A–H money rehearsal carries forward only if the billing/webhook/entitlement/
   email-idempotency runtime is byte-identical between `1b7dfef` and FINAL SHA (v24 is
   tooling/docs only, so it is — confirm with `git diff`).

Until step 5, strict public paid stays **PENDING OWNER RECERTIFICATION**; scale
expansion stays **GATHERING DATA** (no mature cohort report — never fabricated).

## Recertification at the final SHA — DONE (2026-09-23)

**FINAL SHA = `2543a38a41cb6689b17acc9cc1d96059b785e774`.** The first RC at `4b5a795`
(run 35811243648) failed at the Freeze step. `freeze-candidate.mjs` carried the promoted
manifest's historical `release-check` pass at `1b7dfef` into a fresh candidate. `e159dee`
fixed that: stale passes reset to `blocked`, and a fresh candidate no longer inherits the
base's superseded marker. The contract tests now freeze the promoted manifest shape.

| Step | Result | Evidence |
|---|---|---|
| 1. Merge to `main` | done, FINAL SHA `2543a38` | `origin/main` = `2543a38` |
| 2. Release-candidate workflow | **success**, all 21 steps incl. hard audit, authenticated matrix (120 total / 93 passed / 0 failed / 27 skipped) and **Freeze** | [run 35814658356](https://github.com/primocera/Mellowa/actions/runs/35814658356); `docs/release/evidence/v17/candidate/2543a38a41cb6689b17acc9cc1d96059b785e774.json` |
| Dependency audit | clean, 0 production advisories, pinned to `2543a38` | `docs/release/evidence/v23/dependency-audit/2543a38a41cb6689b17acc9cc1d96059b785e774.json` |
| 3. Deploy exact SHA | public `GET /api/health` → `{"ok":true,"version":"2543a38"}` | observed 2026-09-23 |
| 4. Paid readiness | authenticated `GET /api/health/ready` → **HTTP 200**, `mode: paid`, every component `ok` (incl. `cron_billing_reconcile_freshness`), `version: 2543a38` | owner-run 2026-09-23, operator Primoz Cerar; no secret recorded |
| 5. Promote | `manifest.v22.json` → `promoted`, `rcSha == buildId == suites.sha == deployed == 2543a38`; `P0-V24-DEPLOY-PARITY` closed | reviewed manifest edit (v23 pattern); verdicts derived by `deriveVerdicts`, not typed |
| 6. Live A–H carry-forward | valid: `git diff 1b7dfef..2543a38` touches no runtime path | billing/webhook/entitlement/email-idempotency byte-identical |

**Derived verdicts at `2543a38`:** code gate **GO** · capped beta **GO** · public paid
**GO** · scale expansion **GATHERING DATA** (no mature cohort report, never fabricated).

**Prompt 3 step 6 — post-deploy smoke: PASSED** (owner-attested 2026-09-23, operator
Primoz Cerar, on mellowa.app at `2543a38`): login, plan load, one adjustment, checkout
open, portal. The owner reported that everything works. No PII or secrets recorded.

**Prompt 3 step 7 — throwaway subscription hygiene: PASSED for the subscription**
(owner-attested 2026-09-23, operator Primoz Cerar): the live throwaway subscription is
cancelled and cannot renew. The owner has **not re-confirmed** exactly-once delivery of
the cancellation and payment-recovered emails for this step. That behaviour was
witnessed in the live A–H rehearsal (2026-09-05, `docs/release/v22/LIVE-TRANSACTION-EVIDENCE.md`)
and carries forward: the email-idempotency runtime is unchanged `1b7dfef..2543a38`.

**Owner items not recorded (NOT RUN, not claimed):**
- Prompt 4: independent read-only certification.

**Known release-tooling gaps. Fix with the next RC; each changes `scripts/`/workflow and
would supersede this candidate:**
- `freeze-candidate.mjs` falls back to the base manifest's evidence text for code suites
  when the run summary gives none. The frozen record's code-suite evidence strings
  therefore name the old v23 run, even though their `sha` is correctly `2543a38`. The
  promoted manifest points at run 35814658356.
- The RC workflow does not upload the authenticated-matrix evidence JSON
  (`docs/release/evidence/v13/auth-matrix/<sha>.json`). `promote-candidate.mjs` cannot
  re-verify its hash, which is why promotion used the reviewed-edit path.
- **Docs-only commits still deploy.** The Ignored Build Step above is not configured in
  Vercel (`6b71726` auto-deployed). The promotion commit therefore stays **local/unpushed**
  until that is configured. Otherwise pushing it moves `/api/health` off `2543a38`.
