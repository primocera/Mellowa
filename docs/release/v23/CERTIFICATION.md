# Mellowa v23 — exact-SHA release certification (Prompt 4)

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
| Public browser journeys | `npm run test:e2e:public` | **NOT RUN locally** (Playwright browsers/seeded env). Runs as a required job in the RC workflow. | OWNER / CI — NOT RUN |
| Authenticated E2E matrix | `npm run test:e2e:matrix` | **NOT RUN locally** (seeded non-production Supabase + Stripe TEST). Required job in the RC workflow; fails closed on skip/zero-discovery. | OWNER / CI — NOT RUN |

The RC workflow additionally runs the **hard `npm audit --omit=dev` gate** after
`npm ci` (no `continue-on-error`); an unavailable audit blocks and is never read as
0. The audit artifact, candidate record, build, public E2E and authenticated E2E are
uploaded SHA-pinned; freeze verifies artifact SHA == checked-out SHA == candidate SHA.

## Phase 3 — freeze & deploy parity

- **RC not yet frozen on a v23 SHA.** Freezing the immutable RC is owner-gated
  (release-candidate workflow) — [OWNER-CHECKLIST.md](OWNER-CHECKLIST.md) step 2.
- **Not yet deployed.** After deploy, public `/api/health` must show the exact new
  SHA / provable build identity, and authenticated paid `/api/health/ready` must
  return 200 (checklist steps 1 & 3). Claude performs no deploy or live charge.

## Phase 4 — canonical release truth

- **One active manifest.** `docs/release/manifest.v22.json` is now
  `candidateLifecycle: superseded` (v23 dependency patch), every tier + scale
  expansion **UNASSESSED**; `docs/release/v22/STATUS.md` re-rendered from it.
  Historical manifests (v11/v13/v16/v20) unchanged.
- **Dependency evidence** originates from a fresh SHA-pinned audit artifact
  (`scripts/audit-dependencies.mjs`), never a hand-typed `openDependencyAdvisories:
  0`. Owner evidence no longer hand-types the count; `matureValue` = **absent**.
- **Mature cohort** affects `scale_expansion` only (GATHERING DATA), never the paid
  MVP — it is not represented anywhere as an already-met condition.
- **No active document** asserts NOT RUN and DONE for the same owner gate
  (`tests/active-doc-truth.test.ts` enforces it); the v22 §7 contradiction is fixed.

## Verdicts (separated — not merged)

| Tier | Current verdict | Basis |
|---|---|---|
| Automated code gate | **GO** (this working tree) / to be recorded by the RC | Code gates green; audit 0; build + manifest green. |
| Capped beta | **UNASSESSED** | No immutable RC is frozen on the v23 SHA yet. At `faf5d16` this was GO; a re-cut re-derives it. |
| Supervised paid MVP | **UNASSESSED** | Same — needs the re-cut RC + the deployed paid readiness probe. `matureValue` is NOT a gate here. |
| Strict public paid | **UNASSESSED** | Same, plus the production `release-check` + a clean **fresh** audit artifact at the new SHA. |
| Scale expansion | **GATHERING DATA** | No redacted mature-cohort report exists (`matureValue` absent). Stays GATHERING DATA — never a fabricated pass — until one does. 10× capacity is post-MVP. |

### Minimal remaining path to re-open paid (owner)

1. Deploy the v23 candidate; `/api/health` shows the new SHA. — owner, checklist §1.
2. Cut the RC via the release-candidate workflow (audit gate + authenticated matrix
   green); it writes the SHA-pinned audit artifact. — owner/CI, checklist §2.
3. Authenticated paid `/api/health/ready` = 200. — owner, checklist §3.
4. `promote-candidate.mjs --candidate <artifact> --owner-evidence
   docs/release/v22/owner-evidence.v22.json --audit-artifact <sha>.json` → derives
   capped-beta / supervised-paid GO (as at `faf5d16`), scale_expansion GATHERING
   DATA. Acceptance evidence: the RC run url + the audit artifact + the readiness 200.

**Owner:** Primoz Cerar. **Deadline:** owner's discretion (security patch is ready to
ship; the app remains live on the prior deployment until re-cut).

## DONE-IN-CODE vs VERIFIED vs OWNER-ONLY

- **DONE IN CODE:** dependency bump (next/eslint-config-next/sharp/baseline-browser-mapping);
  hard audit gate + SHA-pinned artifact (`audit-dependencies.mjs`, workflow, emit/freeze);
  `matureValue`/`scale_expansion` split (`candidate-lib.mjs`, `manifest.ts`,
  `promote-candidate.mjs`, renderer); v22 doc/manifest reconciliation; new tests.
- **VERIFIED LOCALLY:** audit 0, typecheck, lint (tracked), vitest 2205 pass (+2
  Windows-only), release-manifest 86, build.
- **VERIFIED IN CI:** — (the RC workflow run the owner cuts records this).
- **OWNER ONLY — NOT RUN:** deploy, RC freeze on the v23 SHA, public + authenticated
  E2E in the seeded env, paid readiness probe, throwaway-sub hygiene, promotion.

**Explicit:** no missing evidence was interpreted as a pass; every NOT RUN above is
recorded as NOT RUN, and every tier that lacks a frozen v23 RC reads UNASSESSED.
