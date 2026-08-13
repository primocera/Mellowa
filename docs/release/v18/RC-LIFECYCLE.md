# Release-candidate lifecycle (MW-V18-02 — honest per-suite recording)

Builds on the MW-V17-02 immutable candidate mechanism. It does **not** replace it:
the artifact is still a SHA-pinned, immutable, computed record whose verdicts are
**derived** (`scripts/candidate-lib.mjs` → `deriveVerdicts`), never hand-typed.
MW-V18-02 repairs one specific gap and separates the three evidence classes.

## The gap this closed

The RC workflow ran the authenticated matrix, then froze with a blanket
`freeze-candidate.mjs --mark-code-green`. That flag recorded only the code gates;
`e2e-authenticated` was **not** recorded even though it had just passed, and the
verdict rule required *all* required suites. So a fully green RC run could freeze
**capped beta / public paid as NO-GO purely because its passing auth suite was
never written down**. Worse, the same sweep tempted a non-production run to treat
the production-only `release-check` as a suite it could mark green.

## Three evidence classes (kept apart in schema + verdict derivation)

| Class | Suites | Who may record it | Drives |
|---|---|---|---|
| `code` | lint, typecheck, unit-contract-safety, eval-gate, production-build, e2e-public | any CI/local run | `automated_code_gate` |
| `auth_journey` | e2e-authenticated | the **non-production** RC (Stripe TEST, seeded throwaway Supabase) at the candidate SHA | `capped_beta` (hard), `public_paid` (hard) |
| `production_owner` | release-check | **owner/production only**, at promotion — never a non-production RC | `public_paid` (hard) |

- `automated_code_gate` depends **only** on the code suites.
- `capped_beta` needs code green **and** the authenticated journey observed at the
  candidate — it does **not** depend on `release-check`.
- `public_paid` additionally needs `release-check` passing **and** owner live/value
  evidence. A non-production candidate leaves `release-check` blocked, so it can
  never read an active paid verdict on its own.

## Honest recording: run summary, not mark-green

The workflow emits a run summary (`scripts/emit-rc-run-summary.mjs`) listing every
suite that actually executed. `freeze-candidate.mjs --run-summary <file>` records a
pass **only** from that summary, and independently re-verifies the authenticated
matrix against its own SHA-pinned evidence (exists, `sha === candidate`,
`passed > 0`, `failed === 0`). It **refuses** to mark any `production_owner` suite
from a non-production run. `validateCandidateArtifact` fails closed with a new
`production_gate_faked` rule if a production-only suite is passing in a
non-production candidate.

## State diagram

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> frozen: release-candidate.yml at SHA\n(code + auth recorded honestly;\nrelease-check left blocked)
    frozen --> promoted: promote-candidate.mjs verifies\nhash/provenance/HEAD/owner-evidence\n→ reviewed manifest change
    frozen --> superseded: product-code drift past the RC
    promoted --> superseded: product-code drift past the RC
    superseded --> draft: cut a new candidate
    note right of frozen
      immutable, SHA-pinned;
      verdicts DERIVED
      code=GO, beta may be GO,
      paid NO-GO (no production evidence)
    end note
```

## Exact operator commands

**1. Freeze** (dispatch the immutable gate at the exact candidate SHA):

```bash
gh workflow run release-candidate.yml -f candidate_sha=<40-hex SHA>
# (or push a signed rc/* tag)
```

The workflow validates the manifest; runs lint/typecheck/test/eval/build/public-E2E;
requires the seeded authenticated matrix (preflight fails closed on any missing
secret, non-test Stripe key, zero discovered tests); emits the run summary; then
`freeze-candidate.mjs --run-summary /tmp/rc-run-summary.json` writes and uploads
`rc-evidence-<sha>`. The RC serves a **preview/test** app URL, never the live origin.

**Local dry-run** (no CI, no promotion — records local passes only):

```bash
node scripts/emit-rc-run-summary.mjs --out /tmp/rc-run-summary.json \
  --auth-evidence docs/release/evidence/v13/auth-matrix/$(git rev-parse HEAD).json
node scripts/freeze-candidate.mjs --assume-valid --run-summary /tmp/rc-run-summary.json \
  --out /tmp/candidate.json
```

**2. Review** — download the artifact; confirm `rcSha`, verdicts, evidence hashes.

**3. Promote** — verify provenance/HEAD/evidence/owner-evidence and emit a proposal:

```bash
# dry-run verification (exits non-zero if not promotable):
node scripts/promote-candidate.mjs --candidate docs/release/evidence/v17/candidate/<sha>.json

# with production owner evidence (required for any active public-paid verdict):
node scripts/promote-candidate.mjs \
  --candidate docs/release/evidence/v17/candidate/<sha>.json \
  --owner-evidence docs/release/evidence/v18/owner/<sha>.json \
  --write --out docs/release/manifest.v16.promoted-<sha>.json
```

Promotion never overwrites the tracked manifest and never hand-types a verdict; it
writes a **proposed** manifest a human adopts via PR, at which point
`tests/release-manifest.test.ts` re-validates it and
`npm run render-release-status` regenerates STATUS.md.

**4. Rollback** — flag-based and data-safe; code rollback target is in
`manifest.rollback`. A `superseded` mark invalidates a stale candidate.
</content>
