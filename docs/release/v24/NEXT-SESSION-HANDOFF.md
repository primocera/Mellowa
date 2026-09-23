# Mellowa v24 — next-session handoff (RC freeze bug)

**Date:** 2026-09-23 · **Branch:** `main` = `v24` HEAD = **`4b5a7952c48769a47d08c9ee0b43a53ed7527ee5`**
(fast-forwarded from `f0dbcf5`; v24 PR merged). Owners: Primoz Cerar (eng), Tjasa Kumer (prompt).

## Where we are

v24 (release-truth reconciliation, Prompt 2) is **merged to `main`**. The local gate is
green (typecheck/build/eval/release-manifest ✓; `npm audit --omit=dev` = 0; vitest 2219
pass / 2 pre-existing Windows-only CRLF fails on the historical v16/v20 STATUS pages,
green on CI). The active manifest honestly reads **SUPERSEDED / UNASSESSED**, strict
public paid **PENDING OWNER RECERTIFICATION**, scale expansion **GATHERING DATA**.

The owner ran the immutable **Release Candidate** workflow at `4b5a795`
([run 35811243648](https://github.com/primocera/Mellowa/actions/runs/35811243648)) and it
**FAILED** — but only at the very last step.

## The RC failure — root cause (BLOCKER for the next session)

Run 35811243648, job "Certify release candidate": **steps 1–19 all passed**, including the
hard dependency audit, the v22 status render-check, lint/typecheck/unit/eval/build, public
E2E, and — importantly — the **required Authenticated E2E matrix (step 18) PASSED** at
`4b5a795`. It failed at **step 20 "Freeze the candidate record."**

**Why:** v24 WS-A repointed `scripts/freeze-candidate.mjs` from the archived v16 manifest
to the canonical active manifest (`docs/release/manifest.v22.json`). But v22 is a
**promoted, now-superseded** manifest that records historical passes pinned at the OLD RC
`1b7dfef` — in particular `release-check: live_rehearsed` (a `production_owner` suite) and
the other suites at `sha: 1b7dfef`. When freeze cuts a fresh candidate at `4b5a795`:

- The run summary overrides the 8 code/auth/audit suites → `ci_pass` at `4b5a795` (fine).
- But `release-check` is **not** in the run summary (by design — production-owner). Freeze
  hits its carry-forward path, keeps `status: live_rehearsed`, `sha: 1b7dfef`, and then
  `validateCandidateArtifact` fails closed with:
  - `production_gate_faked` — a passing `release-check` in a `non_production` candidate, and
  - `wrong_sha` — `release-check` passed at `1b7dfef` but the candidate is `4b5a795`.

So freeze correctly refuses to write a candidate that would carry a stale production-owner
pass — but that means **no fresh RC can be frozen off the promoted/superseded active
manifest**. This is a v24 regression: the old v16 default was a clean-slate template
(non-passing suites), so freeze never carried a stale pass.

## The fix (do this first next session)

In `scripts/freeze-candidate.mjs`, the base manifest supplies the suite **list + required
flags**, but a fresh candidate must NOT inherit historical pass statuses recorded at a
different commit. In the per-suite mapping, when a suite is **not** in the run summary:

1. If it is a `production_owner` suite (`release-check`), reset it to a non-passing baseline
   (`status: "blocked"`, drop `sha`/`evidence`) — a non-production freeze never carries a
   production-owner pass. (This is the exact rule `validateCandidateArtifact` already
   enforces; freeze should not produce a record that violates it.)
2. For any other passing suite whose `s.sha !== rcSha`, reset it to `blocked` (drop
   `sha`/`evidence`): a pass at another commit does not certify this candidate.
3. Only carry a pass forward when `s.sha === rcSha` (a genuine same-commit owner pass).

Then add a contract test (extend `tests/rc-workflow-contract.test.ts` or a new one):
**"freezing the promoted/superseded active manifest at a NEW sha yields a valid candidate"**
— `release-check` reset, no `wrong_sha` / `production_gate_faked`, code+auth+audit recorded
from the summary. Re-run the full gate; then the owner re-runs the RC workflow at the new
final SHA.

> Note: the `tests/rc-workflow-contract.test.ts` mechanism tests pass today because they
> freeze against a **clean-slate fixture** (suites reset to `blocked`). That fixture masked
> this bug — the real RC freezes against the promoted v22 manifest. The new test must
> freeze against the promoted-manifest shape (or the real active manifest) to catch it.

## Freeze fix — DONE (2026-09-23)

Implemented in `scripts/freeze-candidate.mjs`:

- Every suite starts from a non-inherited baseline. A `production_owner` suite
  (`release-check`) always resets to `blocked` (no sha/evidence/counts). Any other pass is
  carried only when `s.sha === rcSha`; otherwise it resets to `blocked`. A pass or fail in
  this run's summary overrides the baseline, as before.
- The base manifest's `supersededNote` is **not** inherited by the fresh candidate. It
  describes the OLD RC, and cutting a new RC is how a superseded line gets resolved.
  Without this, a green RC froze all-UNASSESSED verdicts. Open blockers are current state
  and still apply.
- New contract tests in `tests/rc-workflow-contract.test.ts` freeze the **real promoted
  v22 manifest shape** at HEAD. `release-check` resets and the candidate is valid (no
  `wrong_sha`/`production_gate_faked`, code gate GO). A stale non-owner pass that this run
  did not execute resets to `blocked`.
- Local simulation against the actual `manifest.v22.json` froze successfully:
  `code=GO, beta=NO-GO, paid=NO-GO`. Beta is NO-GO because the open P0-V24-DEPLOY-PARITY
  blocker is honest until deploy parity is proven.
- Gate: typecheck ✓, eslint on tracked code ✓ (`npm run lint` flags only the untracked
  owner scratch `*.js` in the repo root, which are not in git/CI), eval ✓, build ✓,
  release-manifest ✓, v22 render --check ✓, `npm audit --omit=dev` 0, vitest 2221 pass /
  2 known Windows-only CRLF fails (release-v16/v20 STATUS; green on CI).

### Promote note (verified by dry-run)

`promote-candidate.mjs` re-derives the candidate's verdicts against the promote-time
manifest. If you remove P0-V24-DEPLOY-PARITY **before** running it, the candidate's frozen
`capped_beta: NO-GO` no longer matches the derived GO → `verdict_mismatch`. Working route:

1. In the base manifest, remove only `supersededNote`. Promote refuses a superseded base.
   Keep the blocker.
2. Run `promote-candidate.mjs --candidate … --audit-artifact … [--owner-evidence …] --write`.
   Verified: "promotable", `code=GO, beta=NO-GO`.
3. After parity is proven (deploy == FINAL SHA, ready=200), close P0-V24-DEPLOY-PARITY in
   the reviewed proposal and re-derive the verdicts with `npm run release-manifest` + a
   re-render. This is the same reviewed-edit path v23 used (f0dbcf5).

## After the freeze fix — owner sequence to reach parity

1. Merge the fix to `main`; note the new **FINAL SHA**.
2. Re-run **Release Candidate (immutable gate)** at FINAL SHA — must reach a **frozen**
   candidate (all steps incl. Freeze green). The authenticated matrix already passes.
3. Deploy exactly FINAL SHA; public `/api/health` returns its short SHA (currently the
   merge may have deployed `4b5a795` — confirm).
4. Authenticated `/api/health/ready` (`LAUNCH_MODE=paid`) = 200, all paid-critical ok.
5. Promote the frozen candidate → `rcSha == buildId == productHeadSha == deployed ==
   FINAL SHA`; closes `P0-V24-DEPLOY-PARITY`; verdicts return to GO where evidence supports.

## Guardrails (unchanged)

Release tooling + docs only. No product/billing/entitlement/webhook/AI-safety/data change.
Owner-only: RC dispatch, deploy, live money, secret rotation, migrations. No fabricated GO;
missing evidence stays NOT RUN. Never commit the prompt `.txt` files.
