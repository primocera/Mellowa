# MW-P2-11 — Cold-start & field performance proof (status: tooling ready, owner-BLOCKED)

**Verdict: BLOCKED — needs a deployed preview and field data.** Claude Code
cannot deploy to a preview or collect real-device traffic, so no cold-start or
field number is claimed here. The measurement machinery already exists (MW-V12-07)
and is green at launch/v13; this is the run + data step only.

## Already built (verified at launch/v13)

- Warm vs cold lab separation: `e2e/perf.spec.ts` — `PERF_MODE=cold` skips the
  warm-up so the navigation pays serverless start-up. Warm is the gate; cold is
  labelled advisory (one flaky cold run can never block a candidate).
- Anonymous field collection: `src/app/api/vitals/route.ts` records LCP/CLS/INP
  from real visitors, no PII.
- Field-vs-lab discipline: `docs/perf-field.md` — a **field** claim requires
  **≥100 samples** per metric+route and reports **p75 only**; below that it is
  "insufficient field data" and lab is provisional. The lab interaction probe is
  never called INP.
- Warm lab baseline (v12 RC, recorded): landing LCP 828ms / pricing 656 / signup
  676 against a 2500ms budget; CLS 0. These do not carry forward as v13 evidence
  until re-run at the v13 candidate.

## Owner run (produces the evidence)

1. Deploy the v13 candidate (the SHA MW-FINAL pins) to an approved Vercel preview.
2. Cold-start lab: `PERF_MODE=cold npm run perf` against the preview URL; record
   cold LCP/INP/CLS for public home, sample, auth handoff, Today, adjust commit,
   Undo. Compare to warm on the same commit class.
3. Field: leave `/api/vitals` collecting; once **≥100 eligible INP samples** exist
   for a route, report p75. Until then label INP **insufficient data**
   (P2-INP-UNMEASURED stays open).
4. Fix only **measured** bottlenecks (bundle/route, fonts/images, hydration,
   unnecessary client components, DB waterfalls). **Never** remove an auth check,
   safety validation, atomic transaction, usage finalization or accessibility to
   improve a score.

## Acceptance mapping

| Criterion | Status |
| --- | --- |
| Before/after on same commit class + environment | BLOCKED (owner deploy) |
| No correctness/security regression | Enforced by the "fix measured only" rule |
| Cold-start works from a clean session; lab vs field labelled | Tooling ready; data owner-run |

Tracked by blockers P2-COLD-START and P2-INP-UNMEASURED — both non-blocking for
capped beta, owner-run for public paid scale. No performance number invented.
