# Launch rehearsal & go/no-go scorecard (Prompt Pack v7, MW-11)

**Release candidate:** branch `v7` — written at the tip of the MW-01..MW-11
pass (supersedes `launch-go-no-go-v6.md`; the v6 document stays as history).
Freeze the exact commit before executing the live steps below and record it
here: `RC commit = ____________`.

**Scope of this document:** it records what the automated release suite proves
in this environment, and — honestly — what only a human operator can verify in
production. Per the delivery rule, **nothing here claims production behaviour
was verified from tests or mocks.**

---

## 1. Automated gates (verified in-repo at v7 tip)

| Gate | Command | Status |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 errors (8 pre-existing warnings) |
| Type safety | `npm run typecheck` | ✅ clean |
| Unit/contract/safety suite | `npx vitest run` | ✅ 427 passing / 61 files |
| Adversarial red-team matrix | `npx vitest run tests/adversarial-matrix.test.ts` | ✅ obfuscation, injection, fail-closed |
| Safety + eval gate | `npm run eval` | ✅ (part of suite) |
| Production build | `npm run build` | ✅ clean |
| Public browser journeys | `npm run test:e2e:public` | ✅ 24 passed (desktop + mobile) |
| Authenticated browser journeys | `npm run test:e2e` | ⚠ 4 skipped — needs seeded test user env |
| Env/readiness presence | `npm run release-check` | ⚠ run with prod env pulled |

New v7 protections on top of v6: safety gate wired into **every** AI route
(habit-plan gap closed), obfuscated/typo crisis language blocked
deterministically, trial-neutral 402/paywall copy everywhere, Billing branches
on server-derived trial eligibility (no second-trial implication), pre-submit
journal AI disclosure, sample entitlement disclosed before generation, and
canonical Stripe prices as the only price source in UI.

## 2. Live rehearsal — operator must execute (evidence required)

Unchanged from v6 (none of these can be proven from this environment):

- [ ] **One real low-value transaction** end to end: verified signup →
      onboarding → free sample → live trial checkout → exact charge disclosure
      → cancel → reactivate → billing portal → refund/support path. Evidence: __
- [ ] **Stripe/webhook reconciliation**: run `/api/cron/billing-reconcile`,
      confirm `ok:true`. Evidence: __
- [ ] **Email outbox**: trigger + confirm delivery, retry and dead-letter
      visibility. Evidence: __
- [ ] **AI cost/latency + daily cost ceiling** observed live. Evidence: __
- [ ] **Cron completion**: all five crons fire (native + external pingers).
- [ ] **Export/delete** on a test account; confirm no rows remain.
- [ ] **Backup restore evidence + rollback drill** (Supabase PITR; redeploy).
- [ ] **Load test** at beta peak + 3× with provider 429/timeout injection —
      no duplicate billing/generation. Evidence: __
- [ ] **Key rotation drill**: rotate `SUPABASE_SERVICE_ROLE_KEY`, app recovers.
- [ ] **Authenticated Playwright suite** with a seeded synthetic user against
      a staging environment. Evidence: __

## 3. Remaining items by severity

| Sev | Item | Owner | Deadline | Mitigation |
|---|---|---|---|---|
| P0 | Live transaction rehearsal not yet run | Primoz | before any invite | none — hard gate |
| P0 | Migrations applied to the live project (verify ref vs Vercel URL) | Primoz | before invite | app assumes them |
| P1 | Cron pingers for retention + billing-reconcile not configured | Primoz | week 1 | webhook keeps subs in sync meanwhile |
| P1 | `SUPABASE_SERVICE_ROLE_KEY` rotation pending | Primoz | before paid launch | key only in Vercel env today |
| P1 | Binary PWA PNG icons (192/512) | Primoz | before paid launch | SVG installs fine |
| P1 | Subprocessor DPA/residency + legal-page review with counsel | Primoz | before paid launch | docs/runbooks/privacy-requests.md |
| P1 | Consented beta testimonials (no fabricated social proof) | Primoz | after beta research | none shown until real |
| P2 | Sentry (or equivalent) SDK not installed | Primoz | week 2 | structured logs + health checks |

## 4. Invite cap

Open to **25–50 people** for the first cohort. Do not widen until section 2
evidence is complete and the daily cost ceiling has been observed under real
usage.

## 5. Rollback triggers

Roll back (redeploy previous commit) or pause invites immediately if any of:

- Any duplicate charge or duplicate generation observed.
- Unsafe AI output or an allergen exclusion miss reaches a user.
- Auth/data exposure of any kind.
- Billing reconciliation cannot reach `ok:true` after one manual run.
- Email delivery failure rate that dead-letters more than a handful of
  messages, or any sensitive content found in a sent email.
- p95 generation latency or provider error rate makes the app unusable and the
  curated fallback is not covering it.

## 6. Verdict

- **Public paid launch: NO-GO.** Section 2 live evidence and the P0/P1 items in
  section 3 are open. Nothing in the v7 code pass changes this — the blockers
  are external configuration and live rehearsal, not code.
- **Small invite-only beta (≤50): CONDITIONAL GO** — permitted once the two P0
  rows are closed, with P1 items tracked to their deadlines and rollback
  triggers armed.

Signed: ________________  Date: __________
