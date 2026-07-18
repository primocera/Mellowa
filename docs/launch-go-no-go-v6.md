# Launch rehearsal & go/no-go scorecard (Launch v6, Prompt 25)

**Release candidate:** branch `v6` — this scorecard is written at the tip of
the LS-12..24 work. Freeze the exact commit before executing the live steps
below and record it here: `RC commit = ____________`.

**Scope of this document:** it records what the automated release suite proves
in this environment, and — honestly — what only a human operator can verify in
production. Per the delivery rule, **nothing here claims production behaviour
was verified from tests or mocks.** Live evidence is filled in by the operator.

---

## 1. Automated gates (verified in-repo)

| Gate | Command | Status |
|---|---|---|
| Type safety | `npm run typecheck` | ✅ clean |
| Unit/contract/safety suite | `npx vitest run` | ✅ 382 passing / 57 files |
| Safety + eval gate | `npm run eval` | ✅ (part of suite) |
| Production build | `npm run build` | ✅ clean |
| Env/readiness presence | `npm run release-check` | ⚠ run with prod env pulled |

These prove code correctness, the safety classifier + output guards, allergen
handling, billing reconciliation logic, lifecycle-email privacy, analytics
taxonomy closure, SEO/robots, and governance-runbook completeness. They do
**not** prove live Stripe, live email delivery, or real load behaviour.

## 2. Live rehearsal — operator must execute (evidence required)

Each row is NOT done until the operator records evidence (transaction id,
screenshot, or redacted log) in the release record.

- [ ] **One real low-value transaction** end to end: verified signup →
      onboarding → free sample → live trial checkout → exact charge disclosure
      → cancel → reactivate → billing portal → refund/support path. Evidence: __
- [ ] **Stripe/webhook reconciliation**: run `/api/cron/billing-reconcile`,
      confirm `ok:true`. Evidence: __
- [ ] **Email outbox**: trigger + confirm delivery, retry and dead-letter
      visibility. Evidence: __
- [ ] **AI cost/latency + daily cost ceiling**: confirm ledger records and the
      ceiling halts generation as designed. Evidence: __
- [ ] **Cron completion**: daily-reminders, trial-reminders, retention,
      email-outbox, billing-reconcile all fire (native + external pingers).
- [ ] **Export/delete**: run both on a test account; confirm no rows remain.
- [ ] **Backup restore evidence + rollback drill**: Supabase PITR restore
      checked; redeploy previous commit rehearsed.
- [ ] **Load test**: expected beta peak + 3×, with provider 429/timeout
      injection and DB connection pressure; confirm graceful backpressure and
      **no duplicate billing/generation** (idempotency keys + claim RPCs).
      Evidence: __
- [ ] **Key rotation drill**: rotate `SUPABASE_SERVICE_ROLE_KEY`, app recovers.

## 3. Remaining items by severity

| Sev | Item | Owner | Deadline | Mitigation |
|---|---|---|---|---|
| P0 | Live transaction rehearsal not yet run | Primoz | before any invite | none — hard gate |
| P0 | Migrations 022–026 applied to the live project (verify ref vs Vercel URL) | Primoz | before invite | app assumes them |
| P1 | Cron pingers for retention + billing-reconcile not configured | Primoz | week 1 | webhook keeps subs in sync meanwhile |
| P1 | `SUPABASE_SERVICE_ROLE_KEY` rotation pending | Primoz | before paid launch | key only in Vercel env today |
| P1 | Binary PWA PNG icons (192/512) | Primoz | before paid launch | SVG installs fine |
| P1 | Subprocessor DPA/residency review with counsel | Primoz | before paid launch | docs/runbooks/privacy-requests.md |
| P1 | Consented beta testimonials (no fabricated social proof) | Primoz | after beta research | none shown until real |

## 4. Invite cap

Open to **25–50 people** for the first cohort (matches the v6 audit's
beta-safe capacity). Do not widen until section 2 evidence is complete and the
daily cost ceiling has been observed under real usage.

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
  section 3 are open.
- **Small invite-only beta (≤50): CONDITIONAL GO** — permitted once the two P0
  rows in section 3 are closed (live transaction rehearsal passed; migrations
  applied to the correct project), with the P1 items tracked to their
  deadlines and the rollback triggers armed.

Signed: ________________  Date: __________
