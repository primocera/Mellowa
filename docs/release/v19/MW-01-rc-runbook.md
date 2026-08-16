# MW-01 — Freeze and certify an immutable v19 release candidate (owner runbook)

**Outcome:** A specific deployable SHA with complete automated evidence.
**Verdict:** BLOCKED on owner action — the immutable RC cut is owner-gated (GitHub
Actions + seeded secrets). No certified candidate is claimed by this prompt.

## Why a fresh RC is required

The v19 product-code prompts (MW-02 … MW-14, XAPP-01/02) merged on branch `v19`
(HEAD `0fa14ca`). This **drifts past** the v16 candidate baseline `e40737b`, at
which the authenticated E2E matrix was last observed (93/0/27, owner-run,
disposable Supabase, Stripe TEST). Per the pack's own rule, superseded-SHA
evidence never carries forward: the prior candidate and its auth-matrix run are
**superseded**, and a new full-SHA RC must be cut at the v19 HEAD. v19 changed no
auth or Stripe code, so no new deterministic auth-E2E failure is expected — but it
**must be re-observed at the candidate SHA**, not assumed.

## What is already green (automated, non-secret)

At the v19 HEAD: `npm run typecheck` (pass) and `npx vitest run`
(**167 files / 2011 tests / 0 fail**). `npm audit --omit=dev` → 0 vulnerabilities.
Migrations enumerated through `049`. These are per-commit signals, **not** frozen
RC evidence until the immutable workflow records them at a single SHA.

## Owner steps to cut the immutable candidate

1. **Merge** `v19` → `main` (fast-forward or merge commit); note the merge SHA.
2. **Apply migrations** `044`–`049` to the disposable and production Supabase (see
   each migration's preflight/verify; `049` is additive + non-destructive, MW-02).
3. **Run `release-candidate.yml`** (immutable workflow) at the merge SHA. It must:
   build once; run manifest validation, status sync, lint, typecheck, unit/
   contract/safety, eval, production build, public E2E and the **authenticated
   matrix** in one run; require non-zero tests and zero required skips; freeze an
   artifact. The auth matrix needs the seeded non-production Supabase + Stripe TEST
   secrets (the 9 GH secrets); a missing secret or zero discovered tests fails the
   RC run independent of any mutable gate.
4. **Promote** with `scripts/promote-candidate.mjs`: sets `rcSha`, lifecycle,
   suite statuses and provenance from the frozen run — without marking the
   production-only `release-check` or any live transaction passed.
5. **Re-observe** the authenticated matrix at the candidate SHA and record exact
   pass/fail/skip; this closes `P1-AUTH-E2E-AT-HEAD` at the *new* SHA (the v16
   closure at `e40737b` does not carry forward).

## What stays separate (never folded into the code gate)

- Production `release-check` (fails closed without prod env) — owner-run.
- Live-money rehearsal (`P0-LIVE-TRANSACTION`) — **owner-accepted risk carried
  forward** from v16 for a bounded public-paid launch; re-verify with one completed
  current-code live charge before scaling. Claude never executes live money.

## Verdicts until the RC is cut

`automated_code_gate`, `capped_beta`, `public_paid` remain **UNASSESSED**. A green
ordinary CI badge is not an RC verdict.
