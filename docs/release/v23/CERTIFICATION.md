# Mellowa v23 — exact-SHA release certification (Prompt 4)

> **✅ RECERTIFIED at `2543a38` (v24, 2026-09-23): GO / GO / GO; scale expansion GATHERING DATA.**
> RC run 35814658356 froze `2543a38`. Production `/api/health` and authenticated paid
> readiness (200) were observed at the same SHA, and `P0-V24-DEPLOY-PARITY` is closed. See
> [`docs/release/v24/RELEASE-TRUTH-RECONCILIATION.md`](../v24/RELEASE-TRUTH-RECONCILIATION.md)
> and the generated [`STATUS.md`](../v22/STATUS.md). The superseded note below is kept as
> history of the `1b7dfef` record.
>
> **⚠️ SUPERSEDED (v24, 2026-09-22).** This record certified RC `1b7dfef`. It is now
> superseded: production `/api/health` serves `f0dbcf5` (deploy drift) and the v24
> release-truth reconciliation adds release-tooling commits past the frozen RC. The
> `GO` verdicts below are **historical, at `1b7dfef`**; the **current** launch verdict
> for every tier is **UNASSESSED / PENDING OWNER RECERTIFICATION** (see
> `docs/release/manifest.v22.json`, its generated `STATUS.md`, and blocker
> `P0-V24-DEPLOY-PARITY`). A new immutable RC must be cut at the v24 final SHA and
> deployed. No missing evidence is interpreted as a pass.

Independent certifier record for the v23 **dependency security patch + honest
release gate**. No new features; scope is a safe paid MVP. No verdict is inferred
from a score, and **no missing evidence is interpreted as a pass**.

## Phase 1 — candidate identity

| Field | Value |
|---|---|
| Repository | Mellowa (local `dailyflowai`) |
| Branch | `v23` |
| Parent baseline | `af2a0f43612ef752feec117ed24c7732b19df66c` (`af2a0f4`, prior main HEAD) |
| Candidate SHA | the `v23` commit that carries this change (set on commit; the RC the owner cuts pins the exact 40-char SHA) |
| Working tree | v23 changes only; the owner's untracked throwaway root scripts (`pay-invoice.js`, `force-*.js`, `diag.js`, `collect-ids.js`, `cleanup-rehearsal.js`) are **left untouched** and are not part of this candidate |
| Drift vs last frozen RC (`faf5d16`) | **dependency + workflow + tests + docs** — `package.json`/`package-lock.json` (deps), `.github/workflows/release-candidate.yml` (audit gate), `scripts/*`, `src/lib/release/manifest.ts`, `tests/*`, `docs/*`. A dependency/workflow diff **requires a new candidate SHA**; `faf5d16` is superseded and is NOT carried forward. |

## Phase 2 — automated gates (this working tree)

| Gate | Command | Result | Class |
|---|---|---|---|
| Prod dependency audit | `npm audit --omit=dev` | **0** production advisories (info/low/mod/high/critical = 0/0/0/0/0). SHA-pinned artifact written by `scripts/audit-dependencies.mjs`. | VERIFIED LOCALLY |
| Typecheck | `npm run typecheck` | **PASS** (`tsc --noEmit`, 0 errors) | VERIFIED LOCALLY |
| Lint | `npm run lint` | **PASS for all tracked files.** The only errors are in the owner's **untracked** throwaway root scripts, which do not exist in a clean `npm ci` checkout (CI) — no tracked/v23 file lints dirty. | VERIFIED LOCALLY (caveat) |
| Unit / contract / safety | `npx vitest run` | **2205 passed / 2 failed.** The 2 failures are the pre-existing Windows-only CRLF byte-drift on the **historical** `v16`/`v20` STATUS pages (`release-v16.test.ts`, `mw08-release-candidate.test.ts`) — green on CI (Linux/LF); unrelated to v23. Test count increased (new WS-B/WS-C/WS-D suites), none removed. | VERIFIED LOCALLY |
| Release manifest | `npm run release-manifest` | **86 passed / 86** | VERIFIED LOCALLY |
| Production build | `npm run build` | **PASS** (`next build`, exit 0, Next 16.3.5) | VERIFIED LOCALLY |
| Public browser journeys | `npm run test:e2e:public` | **PASS in CI** — RC run [35657030867](https://github.com/primocera/Mellowa/actions/runs/35657030867) (conclusion success) at `1b7dfef`. | VERIFIED IN CI |
| Authenticated E2E matrix | `npm run test:e2e:matrix` | **PASS in CI** — required job in RC run 35657030867 (success); fails closed on skip/zero-discovery, so a green run proves it ran non-zero and passed at `1b7dfef`. | VERIFIED IN CI |
| Hard dependency-audit gate | `node scripts/audit-dependencies.mjs` | **PASS in CI** — RC run 35657030867 (success) ran the gate + wrote the SHA-pinned artifact at `1b7dfef` (0 production advisories, else the run would have failed). | VERIFIED IN CI |

The RC workflow additionally runs the **hard `npm audit --omit=dev` gate** after
`npm ci` (no `continue-on-error`); an unavailable audit blocks and is never read as
0. The audit artifact, candidate record, build, public E2E and authenticated E2E are
uploaded SHA-pinned; freeze verifies artifact SHA == checked-out SHA == candidate SHA.

## Phase 3 — freeze & deploy parity

- **RC FROZEN GREEN at `1b7dfef`.** Release-candidate workflow run
  [35657030867](https://github.com/primocera/Mellowa/actions/runs/35657030867),
  conclusion **success**, head_sha `1b7dfef83eec9570774254a8234f057c6e673a7b` (verified
  via GitHub's public API). Uploaded artifact `rc-evidence-1b7dfef…` (candidate record +
  SHA-pinned dependency-audit). VERIFIED IN CI.
- **DEPLOY DRIFT (v24).** Public `GET /api/health` now returns `version: f0dbcf5`, NOT
  `1b7dfef` — exact-SHA deploy parity is broken, so the frozen RC no longer describes the
  live code. VERIFIED (public probe, 2026-09-22). RC `1b7dfef` is SUPERSEDED (blocker
  `P0-V24-DEPLOY-PARITY`); a new RC must be cut at the v24 final SHA and deployed.
- **Paid readiness — DONE (2026-09-22).** Authenticated `GET /api/health/ready`
  (`mode:paid`) → **200** at `1b7dfef` with **every component ok**, including
  `cron_billing_reconcile_freshness:ok` after re-firing `POST /api/cron/billing-reconcile`
  (→ 200, `report.ok:true`, `unknownPrices:[]`). VERIFIED (owner-run probe).
- **Secret rotation — DONE (owner-attested, 2026-09-21).** The weak, previously-exposed
  `ADMIN_STATS_SECRET` (= `CRON_SECRET`) was rotated to a new value by the owner this
  session. Metadata only; no value handled or stored by Claude. Capture the paid
  readiness probe below using the new secret.

## Phase 4 — canonical release truth

- **One active manifest.** `docs/release/manifest.v22.json` (the ONE canonical active
  path, `scripts/active-manifest.mjs`) is now `candidateLifecycle: superseded` (v24:
  deploy drift + release-tooling commits), every launch tier **UNASSESSED** and scale
  expansion **GATHERING DATA**; `docs/release/v22/STATUS.md` re-rendered from it.
  Historical manifests (v11/v13/v16/v20) unchanged and archived.
- **Dependency evidence** originates from a fresh SHA-pinned audit artifact
  (`scripts/audit-dependencies.mjs`), never a hand-typed `openDependencyAdvisories:
  0`. Owner evidence no longer hand-types the count; `matureValue` = **absent**.
- **Mature cohort** affects `scale_expansion` only (GATHERING DATA), never the paid
  MVP — it is not represented anywhere as an already-met condition.
- **No active document** asserts NOT RUN and DONE for the same owner gate
  (`tests/active-doc-truth.test.ts` enforces it); the v22 §7 contradiction is fixed.

## Verdicts (separated — not merged) — HISTORICAL at `1b7dfef`, SUPERSEDED (v24)

The verdicts below are the **historical** verdicts that held at RC `1b7dfef`. They are
**superseded** (deploy drift + v24 tooling); the **current** launch verdict for every
tier is **UNASSESSED / PENDING OWNER RECERTIFICATION**. Scale expansion stays GATHERING
DATA.

| Tier | Verdict at `1b7dfef` (HISTORICAL — SUPERSEDED v24) | Basis |
|---|---|---|
| Automated code gate | **GO** | Code gates green in the RC run (35657030867) at `1b7dfef`; audit 0; build + manifest green. |
| Capped beta | **GO** | Immutable RC frozen green at `1b7dfef` (authenticated matrix + audit gate), no open blocker. |
| Supervised paid MVP | **GO** | Deployed paid readiness re-probed = 200 all-ok at `1b7dfef`; live A–H carries forward (billing byte-identical); `matureValue` is NOT a gate here. |
| Strict public paid | **GO** | + production `release-check` satisfied by the deployed paid `/api/health/ready`=200 and a clean **fresh** SHA-pinned audit artifact at `1b7dfef`. |
| Scale expansion | **GATHERING DATA** | No redacted mature-cohort report exists (`matureValue` absent). Stays GATHERING DATA — never a fabricated pass — until one does. 10× capacity is post-MVP. |

### Path to full GO — steps below were done at `1b7dfef`, but are SUPERSEDED (v24): re-certify at the new final SHA

1. ✅ Deployed the v23 candidate; `/api/health` → `version:1b7dfef`.
2. ✅ Cut the RC via the release-candidate workflow ([run 35657030867](https://github.com/primocera/Mellowa/actions/runs/35657030867), success) — hard audit gate + authenticated matrix green; SHA-pinned artifact written.
3. ✅ Authenticated paid `/api/health/ready` = 200 at `1b7dfef`, `mode:paid`, every component ok (incl. `cron_billing_reconcile_freshness:ok` after re-firing reconcile → `report.ok:true`).
4. ✅ Secret (`ADMIN_STATS_SECRET`/`CRON_SECRET`) re-rotated + redeployed.
5. ✅ Manifest reconciled → promoted at `1b7dfef`, verdicts capped-beta/supervised-paid **GO**, scale_expansion **GATHERING DATA**; STATUS re-rendered.

**Owners:** Primoz Cerar (engineering) & Tjasa Kumer (prompt engineering).

## DONE-IN-CODE vs VERIFIED vs OWNER-ONLY

- **DONE IN CODE:** dependency bump (next/eslint-config-next/sharp/baseline-browser-mapping);
  hard audit gate + SHA-pinned artifact (`audit-dependencies.mjs`, workflow, emit/freeze);
  `matureValue`/`scale_expansion` split (`candidate-lib.mjs`, `manifest.ts`,
  `promote-candidate.mjs`, renderer); v22 doc/manifest reconciliation; new tests.
- **VERIFIED LOCALLY:** audit 0, typecheck, lint (tracked), vitest 2205 pass (+2
  Windows-only), release-manifest 86, build.
- **VERIFIED IN CI:** RC workflow run 35657030867 (success) at `1b7dfef` — code gates,
  hard dependency-audit gate, public + authenticated E2E, freeze.
- **OWNER-RUN — DONE (2026-09-22):** deploy (`/api/health`=1b7dfef), paid readiness
  probe (200 all-ok), billing-reconcile re-fire (report.ok:true), secret re-rotation,
  and **throwaway subscription cancelled + test account closed** (owner-attested, so the
  leftover live-rehearsal sub cannot renew). Live A–H money rehearsal carried forward
  (billing byte-identical; not re-run).

**Explicit:** no missing evidence was interpreted as a pass; every verdict above is
computed from real evidence at `1b7dfef`, not hand-adjusted to a desired GO.
