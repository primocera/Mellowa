# Mellowa v23 — owner-only production checklist (Prompt 3)

> **Claude executes NONE of the steps below.** This file only *prepares and records*
> owner-run production steps. No live money, production migration, subscription
> cancellation, account deletion, secret rotation or deploy is performed
> automatically. Each step has a command/check, a stop condition and a
> rollback/customer-restoration note; the owner runs it and reports the real result,
> and only then is the evidence recorded. A missing result stays **NOT RUN** — never
> inferred, never fabricated.

## Why v23 exists

The v23 code change is the **production dependency security patch** only:

| Package | Before | After | Advisory resolved |
|---|---|---|---|
| `next` | `16.2.12` | `16.3.5` | GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4 (critical) |
| `eslint-config-next` | `16.2.12` | `16.3.5` | (kept in lockstep with `next`) |
| `sharp` (override) | `^0.35.3` | `^0.35.4` | GHSA-rgj7-g3m4-5g8c (high) |
| `baseline-browser-mapping` (override) | `2.10.43` | `^2.11.0` (2.11.x) | GHSA-w5vr-8v7q-w6rv (moderate) |

`npm audit --omit=dev` = **0 production advisories** after the patch. Because
`package.json` + `package-lock.json` are product code, this diff **supersedes the
frozen v22 RC `faf5d16`**: a dependency diff requires a new candidate SHA. No
Stripe/billing code changed (frozen at v16); no migration added.

## Guardrails (repeat of the non-negotiables)

- Read-only checks only until the owner explicitly confirms a mutation.
- Never print/store API keys, webhook secrets, service-role keys, card data or test-user emails.
- For Stripe evidence use opaque/short ids, UTC time, amount, currency, observed result — no PII.
- If an owner result differs from expected, **stop**; do not hand-edit the DB to get a green doc.
- Every owner step below has a stop condition + rollback/customer-restoration note.

## Owner steps

| # | Step | Type | Stop condition | Rollback / restoration |
|---|---|---|---|---|
| 1 | **Deploy the v23 dependency-patched candidate.** Public `/api/health` must return the new exact SHA (or its provable build identity). | deploy (owner) | `/api/health` still shows the old SHA, or build fails → do not proceed. | Vercel: promote the previous deployment; the prior build is unaffected (deps-only change). |
| 2 | **Cut the immutable RC on the deployed SHA.** Run the release-candidate workflow (workflow_dispatch with the 40-char SHA, or a signed `rc/*` tag). It now runs the **hard `npm audit --omit=dev` gate** (`scripts/audit-dependencies.mjs`) and writes a SHA-pinned audit artifact; a finding or unavailable audit fails the run. | Any required job red, the authenticated matrix skipped/zero-discovery, or the audit gate non-zero → RC not frozen. | No production impact — the RC runs against throwaway fixtures / Stripe TEST. Re-run after fixing. |
| 3 | **Authenticated `/api/health/ready` in `LAUNCH_MODE=paid` = HTTP 200**, every paid-critical component ok, on the deployed SHA. Record a **redacted** summary + UTC only. | Any component not ok, or non-200 → stop; investigate the failing probe. | None (read-only probe). |
| 4 | **Short smoke** (deps-only patch — NOT a full A–H money rerun since billing code is unchanged): login, plan load, one allowed adjustment path, checkout opening in the correct Stripe mode, portal, webhook health. | Any smoke path broken by the Next.js/Sharp bump → stop; roll back the deploy. | Roll back to the previous deployment (step 1 rollback). |
| 5 | **Throwaway subscription hygiene.** Confirm the live-rehearsal throwaway sub from v22 is **cancelled before it can renew**; refund only amounts the owner actually intends to refund; delete the dedicated test account only after confirming the evidence no longer needs it. | A throwaway sub is still able to renew → cancel it before anything else. | Restore access for the test identity if cancelled in error (owner, via Stripe). |
| 6 | **Do NOT re-run secret rotation** unless the owner intends to: v22 recorded `ADMIN_STATS_SECRET`/`CRON_SECRET` rotation (owner-attested). If any interim secret was weak/exposed, re-rotate and redeploy dependents; record metadata only. | A secret is known weak/exposed and not yet re-rotated → re-rotate before opening paid traffic. | Update the cron scheduler secret to match after rotation, else cron auth breaks — restore by re-syncing. |
| 7 | **Confirm the two transactional emails** (cancellation + payment-recovered) each still deliver **exactly once** with no duplicate after the deploy. | A duplicate or missing mail appears → stop; the webhook idempotency guard must be checked. | None (observation). |
| 8 | **Mature cohort stays honest.** Do **not** mark `matureValue` = pass without a real redacted cohort report (measurement window, denominators, results). Record the supervised-paid verdict separately from `scale_expansion` (which stays GATHERING DATA). | Any pressure to type `matureValue: pass` without a report → refuse. | N/A. |

## Evidence record (fill ONE row per actually-executed owner step)

For each executed step store only:
`application` + `candidate_sha`; production deployment id / provable build identity;
action id + short description; `observed_at_utc`; operator/owner name;
`result` ∈ {passed, failed, blocked}; minimal redacted evidence reference;
expected state vs observed state; stop condition + any rollback result.

| # | application | candidate_sha | deploy id / build identity | observed_at_utc | operator | result | expected → observed | evidence ref |
|---|---|---|---|---|---|---|---|---|
| 1 | mellowa | _pending_ | _pending_ | _pending_ | _pending_ | **NOT RUN** | new SHA on /api/health → _pending_ | _pending_ |
| 2 | mellowa | _pending_ | (RC workflow run url) | _pending_ | _pending_ | **NOT RUN** | all gates + audit green, RC frozen → _pending_ | _pending_ |
| 3 | mellowa | _pending_ | _pending_ | _pending_ | _pending_ | **NOT RUN** | ready=200 all ok → _pending_ | _pending_ |
| 4 | mellowa | _pending_ | _pending_ | _pending_ | _pending_ | **NOT RUN** | smoke paths ok → _pending_ | _pending_ |
| 5 | mellowa | _pending_ | (opaque sub/refund ids) | _pending_ | _pending_ | **NOT RUN** | throwaway sub cannot renew → _pending_ | _pending_ |
| 6 | mellowa | _pending_ | _pending_ | _pending_ | _pending_ | **NOT RUN (n/a unless re-rotating)** | secrets strong → _pending_ | _pending_ |
| 7 | mellowa | _pending_ | _pending_ | _pending_ | _pending_ | **NOT RUN** | each email once, no dup → _pending_ | _pending_ |
| 8 | mellowa | n/a | n/a | _pending_ | _pending_ | **NOT RUN** | matureValue absent unless real cohort report → _pending_ | _pending_ |

## Completion criteria

- No owner step is marked DONE before its real output exists.
- The throwaway subscription cannot accidentally renew.
- Mellowa paid readiness is re-confirmed on the **new** dependency-patched SHA.
- Evidence carries no secrets/PII and matches the active manifest.

This checklist does **not** declare GO. It records production results; the final
verdict is produced by [`CERTIFICATION.md`](CERTIFICATION.md) (Prompt 4), computed
from the real evidence at the exact certified SHA.
