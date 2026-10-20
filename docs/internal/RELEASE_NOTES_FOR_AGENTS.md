# Release notes for agents

Moved here from the top of `README.md` so the README can stay a plain project
overview. Nothing was rewritten: the note and the two sections below are the
README text verbatim (only relative link paths were adjusted for this folder).
Release-truth tests read this file.

> **Next prompt pack?** The engineering build (v6–v19) is done and certified. The
> project is now moving toward marketing — the next pack is the **v20 "Moving Toward
> Marketing" pack**, not engineering. Read [`docs/NEXT_STEPS.md`](../../docs/NEXT_STEPS.md)
> **first.** Coding stays open for real fixes; just don't write another engineering
> pack by default.

## Release status

Release truth is **machine-generated**, not hand-written here — so this section
carries no verdicts, counts or SHAs that could drift. Read the verdicts on the
generated status page, not in this prose.

**Current line — v22 launch line, RC `1b7dfef` SUPERSEDED (v24): deploy drift + release-truth reconciliation.** Read the current verdicts on the generated status page — presently UNASSESSED / PENDING OWNER RECERTIFICATION, not GO:

- Machine manifest: [`docs/release/manifest.v22.json`](../../docs/release/manifest.v22.json)
- Rendered status (generated from the manifest; a contract test fails on drift):
  [`docs/release/v22/STATUS.md`](../../docs/release/v22/STATUS.md)
- Certification + evidence:
  [`MELLOWA-FINAL-CLOSURE-CERTIFICATION.md`](../../docs/release/v22/MELLOWA-FINAL-CLOSURE-CERTIFICATION.md),
  [`EVIDENCE.md`](../../docs/release/v22/EVIDENCE.md),
  [`LIVE-TRANSACTION-EVIDENCE.md`](../../docs/release/v22/LIVE-TRANSACTION-EVIDENCE.md)
- Candidate lifecycle & freeze/promote sequence:
  [`docs/release/v17/RC-LIFECYCLE.md`](../../docs/release/v17/RC-LIFECYCLE.md)

**Archived (superseded by v22):** the last-generated snapshot before v22 —
[`docs/release/manifest.v16.json`](../../docs/release/manifest.v16.json) and its rendered
[`docs/release/v16/STATUS.md`](../../docs/release/v16/STATUS.md).

The v23-patched RC `1b7dfef` (release-candidate workflow
[run 35657030867](https://github.com/primocera/Mellowa/actions/runs/35657030867),
success; the v23 production dependency security patch — Next.js / Sharp /
baseline-browser-mapping — with a hard dependency-audit gate) was promoted, but is now
**SUPERSEDED** (v24): production `/api/health` serves `f0dbcf5` (deploy drift, exact-SHA
parity broken), and the v24 release-truth reconciliation adds new release-tooling
commits past the frozen RC. No verdict can be read from a superseded candidate — every
launch tier reads **UNASSESSED** and strict public paid is **PENDING OWNER
RECERTIFICATION** until the owner cuts a new immutable RC at the v24 final SHA and
deploys exactly that SHA. The recorded owner-evidence (migrations 050–054, paid
readiness, live A–H billing rehearsal) remains a true historical record observed at
`1b7dfef` and does not certify the current deploy; the verdicts live in the generated
v22 status + manifest linked above, never restated here. Scale expansion is tracked
separately and stays GATHERING DATA until a mature cohort report exists. Billing code is
frozen at v16 apart from fail-closed failure-path fixes.

Dependency posture is a **hard release gate** (v23): the release-candidate workflow
runs `npm audit --omit=dev` via
[`scripts/audit-dependencies.mjs`](../../scripts/audit-dependencies.mjs), fails closed on any
production finding or an unavailable audit, and writes a fresh, SHA-pinned audit
artifact under `docs/release/evidence/v23/dependency-audit/` that the paid tier's
dependency posture is read from — never a hand-typed count. Historical baseline:
[`docs/release/evidence/v17/dependency-audit.md`](../../docs/release/evidence/v17/dependency-audit.md).

Pricing is USD-first dual-currency (USD everywhere, an EUR region price for
EU/EEA on the same price ids via `currency_options`, gated by
`EUR_PRICING_ENABLED`); the one catalog is `src/lib/stripe/plans.ts`.

### Release history (archived — not current)

Per-release snapshots for v11–v16 live under `docs/release/` and the
`docs/launch-go-no-go-*.md` files. They describe the state **at their time** and
are superseded by the generated status above — do not read them as current
instructions or current verdicts.

## Project state

**Before scoping new work, read [`docs/BUILD_STATE.md`](../../docs/BUILD_STATE.md).**
It is the canonical list of what is already built and tested versus what is
genuinely open, so new prompt packs stop re-commissioning shipped features. The
per-release `docs/launch-go-no-go-*.md` files are history; `BUILD_STATE.md` is
the current truth.
