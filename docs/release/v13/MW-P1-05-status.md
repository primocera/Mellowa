# MW-P1-05 — Authenticated current-candidate E2E matrix (status)

**Verdict: BLOCKED — owner prerequisites.** Claude Code did not and must not run
this. The authenticated matrix needs a **seeded non-production Supabase project**
and **Stripe test mode**; neither exists in this environment, and the seed script
refuses any database without the non-production marker table (`E2E_REQUIRE_SEED_MARKER=1`).

Per the global contract, a missing non-production account is a **blocker, not a
pass**. Old green runs from the superseded v11/v12 candidates (75-test public,
87-execution auth) do **not** carry forward to the v13 candidate.

## What is already built (no env needed) — verified present at launch/v13

- Canonical matrix: `e2e/support/matrix.ts` — 8 user states + 30 required
  journeys (adaptive-day loop, undo atomicity, low-capacity, weekly carry-forward,
  billing states, provider error, timezone repair).
- Integrity gate: `tests/e2e-matrix-integrity.test.ts` — runs in `npm test`; fails
  the build if the matrix, seed script and specs drift apart. **Green at v13.**
- Fail-closed runner: `scripts/run-auth-matrix.mjs` (`npm run test:e2e:matrix`) —
  seeds every fixture, runs all three viewports, tracks each required journey by
  title, BLOCKS in RC mode on any required journey that never ran.
- Production-URL / unknown-DB refusal is enforced by the marker check.

## Coverage gap to close on the owner run (v13-specific)

MW-P0-01/02 changed journal-reflection behavior (output guard + one corrective
retry + usage finalize/release). That is proven at the **route level**
(`tests/journal-reflection-route.test.ts`, 9 tests) but there is **no authenticated
browser journey** for it in the matrix. During the owner matrix run, add/verify a
journal-reflection journey covering:

- Free/non-entitled: journal saves, no premium reflection (`premium_required`).
- Premium safe reflection returned.
- Safety-blocked reflection: entry saved, calm boundary copy, no unsafe text shown
  (`reflection_unavailable: true`).

Until that journey exists and runs, journal reflection stays behind its route-level
proof only — do not market it as a premium benefit (MW-P0-01 acceptance).

## Exact owner procedure (copy-paste; never point at production)

Follow `docs/release/v12/MW-V12-02-owner-commands.md` verbatim, with these v13
substitutions:

1. Check out the v13 candidate SHA (the one MW-FINAL pins), not `745b4a4`.
2. Stand up / reuse the non-production Supabase project and apply **all**
   migrations including **040 and 041**, then create the `e2e_seed_marker` table.
3. Point `.env.local` at the non-prod project + **Stripe test-mode** keys/price ids.
4. Run:
   ```
   npm ci
   npm run build
   E2E_REQUIRE_SEED_MARKER=1 npm run test:e2e:matrix
   ```
5. The runner blocks on any required journey that never ran. Attach the raw
   artifacts under `docs/release/evidence/v13/rc/` and record the candidate SHA +
   environment class (non-prod) in the manifest.

## Acceptance mapping

| Acceptance criterion | Status |
| --- | --- |
| Evidence references exact candidate SHA + env class | BLOCKED (owner run) |
| Core value loop + undo proven atomically | Tooling ready; BLOCKED on run |
| Auth / RLS / billing / journal-safety scenarios | BLOCKED on run; journal journey to add |
| No production base URL used | Enforced by marker refusal |

No E2E result is claimed as PASS here. This file is the runbook + blocker record.
