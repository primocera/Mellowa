# V12 Launch Hardening — Orchestration Plan (Mellowa)

Source: `Mellowa_Launch_Hardening_Claude_Code_Prompts_V12.docx` (repo root — NOT to be committed if it contains prompt content per project rule; the .docx stays out of git).
Branch: `launch/v12` (cut from main @ `e67232a7d9a2803f7147406564bc8a9319b922d8`).
Execution model: Opus 4.8 executes prompts **strictly in order**, one prompt = one focused sub-branch (or focused commit series) merged back into `launch/v12`.

## Scope note
The V12 pack covers two repos. Only these apply to THIS repo (dailyflowai / Mellowa):
- MW-V12-01 … MW-V12-09
- XAPP-V12-01 (Mellowa side only; Scalvya side lives in primocera/LaunchBloom)

SC-V12-01…08 are Scalvya/LaunchBloom prompts — **do not run them here**.

## Pre-existing uncommitted work (from prior session — DO NOT DISCARD)
Present on branch at start; likely relates to trial-reminder/email hardening (feeds MW-V12-04):
- `src/app/api/cron/trial-reminders/route.ts`
- `src/lib/dates/local-day.ts`
- `src/lib/email/templates.ts`
- `tests/email-templates.test.ts`, `tests/local-day.test.ts`
- `HANDOFF_MELLOWA_LAUNCH_STEPS.md` (untracked)
- `docs/runbooks/trial-ending-mistimed-check.sql` (untracked)

First execution step: review + run these tests, then commit them as the opening commit of `launch/v12` (or ask owner if intent is unclear). Blank evidence lines mean unrecorded, not undone — ask the owner before assuming.

## Global execution protocol (MANDATORY, before every prompt)
1. Record exact starting SHA.
2. Read every applicable AGENTS.md and `node_modules/next/dist/docs/` guide for touched areas.
3. Read the canonical launch manifest (`docs/release/manifest.v11.json`) and latest superseding release doc.
4. Inspect existing implementation and tests first — do not rebuild what exists.
5. Focused branch/commit; preserve unrelated changes.
6. NEVER: real charges, refunds, secret access/rotation/printing, production restore/destructive migration, production seeding.
7. skipped / blocked / not_run / configured / unknown ≠ passed.
8. Any product-code change invalidates evidence pinned to an earlier RC SHA.
9. Run repo-required checks (`npm run lint`, `npm run typecheck`, `npm run build`, test suites). Blocked check = reported blocker, never converted to pass.
10. End each prompt with: starting SHA, ending SHA, files changed, commands run, exact pass/fail/skip counts, remaining production/owner actions, rollback notes, honest launch verdict.

## Execution order & status

| # | Prompt | File | Purpose | Status |
|---|--------|------|---------|--------|
| 0 | Pre-work | — | Review/commit uncommitted trial-reminder work | ✅ 878f851 |
| 1 | MW-V12-01 | `MW-V12-01.md` | Reconcile HEAD vs superseded RC 0025a502; manifest truth | ✅ |
| 2 | MW-V12-02 | `MW-V12-02.md` | Full authenticated/daily-state E2E matrix, no silent skips | ✅ (harness; owner-run) |
| 3 | MW-V12-03 | `MW-V12-03.md` | Billing hardening + EUR live-transaction rehearsal runbook | ☐ |
| 4 | MW-V12-04 | `MW-V12-04.md` | Reminder/cron dedupe + email failure-path tests & worksheet | ☐ |
| 5 | MW-V12-05 | `MW-V12-05.md` | Key rotation & restore readiness (docs + readiness tests) | ☐ |
| 6 | MW-V12-06 | `MW-V12-06.md` | Premium recurring-value product/content pass | ☐ |
| 7 | MW-V12-07 | `MW-V12-07.md` | Real-user performance (cold-start, RUM vitals, budgets) | ☐ |
| 8 | MW-V12-08 | `MW-V12-08.md` | Willingness-to-pay beta measurement + scorecard | ☐ |
| 9 | MW-V12-09 | `MW-V12-09.md` | Cut new RC, replace superseded verdict (NO product changes) | ☐ |
| 10 | XAPP-V12-01 | `XAPP-V12-01.md` | Cross-app isolation review (needs LaunchBloom frozen too) | ☐ |

Rules between prompts:
- Do not merge two prompts into one commit.
- MW-V12-09 runs only after 01–08 are merged and tree is clean.
- XAPP-V12-01 is read-only-first; any product-code change there invalidates the affected candidate.

## Owner-only actions (Claude prepares runbooks; owner executes)
- Real EUR 9.99 charge → cancel → reactivate → payment recovery → refund rehearsal.
- Duplicate-cron observation with a still-eligible account.
- Controlled provider-failure rehearsal (safe test account).
- Key rotation + isolated restore with measured recovery time.
- Confirm production migrations/readiness without sharing secrets.

## Verdict rules
- Accepted risk ≠ verified/passed. GO only with zero open/accepted required P0/P1.
- €0 trial start does not close the real-money blocker; contract tests do not close owner evidence.
- Public paid is at most CONDITIONAL GO until capture+refund observed.
- Expansion of paid acquisition requires proven day-2/day-3/week-2 recurring value, not just technical quality.
