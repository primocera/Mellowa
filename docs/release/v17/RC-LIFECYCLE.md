# Release-candidate lifecycle (MW-V17-02)

`draft → frozen → promoted` (or `superseded`). Only an explicit
`release-candidate.yml` run against an input SHA may **freeze**; a frozen record
is SHA-pinned and immutable. Verdicts are **computed** from the gates
(`scripts/candidate-lib.mjs` → `deriveVerdicts`), never hand-typed.

## What each state means

| State | Meaning |
|---|---|
| `draft` | HEAD is moving; nothing frozen; every verdict is `UNASSESSED`. This is the honest current state of `manifest.v16.json`. |
| `frozen` | A specific SHA is the candidate; the RC workflow recorded its gate results and computed verdicts. Immutable. |
| `promoted` | A frozen candidate reviewed and adopted as current release truth. Behaves like `frozen` for every verdict rule. |
| `superseded` | Product code moved past the frozen RC; no verdict can be read until a new candidate is cut. |

## The freeze artifact

`scripts/freeze-candidate.mjs` produces `docs/release/evidence/v17/candidate/<sha>.json`:
rcSha, baselineSha, `frozen` lifecycle, runId, run provenance (`workflow` vs
`local`), timestamp, environment class (`non_production`), migration range,
rollback target, per-suite records (command, status, counts, sha, evidence +
artifact hash), evidence-hash map, and the three **derived** verdicts. It refuses
to freeze a SHA that is not the checked-out HEAD, and refuses to overwrite an
existing candidate file with different content.

`validateCandidateArtifact` fails closed on: a wrong SHA, a verdict that does not
equal the derived one, a bare `local_pass` in a workflow-frozen candidate, a
missing evidence artifact, or a production environment.

## Owner freeze/promote sequence (NOT RUN until the owner runs it)

1. **Freeze** — dispatch the immutable gate at the exact candidate SHA:
   `gh workflow run release-candidate.yml -f candidate_sha=<40-hex SHA>`
   (or push a signed `rc/*` tag). The workflow validates the manifest, runs
   lint/typecheck/test/eval/build/public-E2E, requires the seeded authenticated
   matrix (MW-V17-01 preflight), then (MW-V18-02) emits a run summary and runs
   `freeze-candidate.mjs --run-summary …` and uploads `rc-evidence-<sha>`
   containing the computed candidate. See `docs/release/v18/RC-LIFECYCLE.md` for
   the honest per-suite recording and the three evidence classes.
   - **Expected artifact:** `candidate/<sha>.json` with `runProvenance: "workflow"`,
     code gates `ci_pass` at `<sha>`, owner gates at their recorded status.
   - **Fails closed if:** a required secret is missing, the Stripe key is not a
     test key, zero authenticated tests ran, or the SHA ≠ HEAD.
2. **Review** — download the artifact; confirm rcSha, verdicts, evidence hashes.
3. **Promote** — open a reviewed PR that copies the candidate into the tracked
   manifest (`candidateLifecycle: "promoted"`, rcSha, computed verdicts) and
   regenerates `STATUS.md` via `npm run render-release-status`. The workflow never
   writes to `main`; promotion is this human-reviewed PR.
4. **Rollback** — flag-based and data-safe; code rollback target is in
   `manifest.rollback`. A `superseded` mark invalidates a stale candidate.

Local dry-run (no CI, no promotion) — MW-V18-02 replaced `--mark-code-green` with
an honest run summary; see `docs/release/v18/RC-LIFECYCLE.md` for the exact commands.
