# Launch rehearsal & go/no-go scorecard (Prompt Pack v8, MW-S10)

**Release candidate:** branch `v8` — written at the tip of the MW-S01..MW-S10
pass (supersedes `launch-go-no-go-v7.md`; the v7 document stays as history).
Freeze the exact commit before executing the live steps below and record it
here: `RC commit = ____________`.

**Scope of this document:** it records what the automated release suite proves
in this environment, and — honestly — what only a human operator can verify in
production. Per the delivery rule, **nothing here claims production behaviour
was verified from tests or mocks.**

---

## 1. Automated gates (verified in-repo at v8 tip)

| Gate | Command | Status |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 errors (pre-existing warnings only) |
| Type safety | `npm run typecheck` | ✅ clean |
| Unit/contract/safety suite | `npx vitest run` | ✅ green (record count at RC freeze) |
| Adversarial red-team matrix | `npx vitest run tests/adversarial-matrix.test.ts` | ✅ obfuscation, injection, fail-closed |
| Safety + eval gate | `npm run eval` | ✅ (part of suite) |
| Production build | `npm run build` | ✅ clean |
| Public browser journeys | `npm run test:e2e:public` | ✅ desktop + mobile |
| Authenticated browser journeys | `npm run test:e2e` | ⚠ skipped — needs seeded test user env |
| Env/readiness presence | `npm run release-check` | ⚠ run with prod env pulled |

New v8 protections on top of v7: the Now view with a deterministic, no-AI
selector; atomic remaining-day repair in a single transaction with snapshot
versioning and free Undo; user-removable learned signals with a suppression
boundary; routine presets whose names never enter prompts or analytics; meal
continuity with allergen-validated favourites and a pantry-aware shopping
draft; a bounded weekly reflection whose carry-forward is previewed exactly;
one server-claimed sample adjustment (no card); consent-versioned reminders
with pause/skip; premium packaging around three implemented jobs; and a
strict, documented v8 analytics contract (`docs/analytics-events-v8.md`) with
experiment kill switches (`FLAG_PLAN_REPAIR`, `FLAG_WEEKLY_REFLECTION`).

## 2. Live rehearsal — operator must execute (evidence required)

None of these can be proven from this environment:

- [ ] **Apply migrations 027–033 to the live Supabase project** (plan repair
      versions + RPCs, learned suppressions, presets, meal continuity columns,
      weekly reflections, sample adjustment claim, reminder controls). The v8
      app assumes them; deploying without them breaks repair/presets/
      reflection. Evidence: __
- [ ] **One real low-value transaction** end to end: verified signup →
      onboarding → free sample → **one sample adjustment** → live trial
      checkout → exact charge disclosure → cancel → reactivate → billing
      portal → refund/support path. Evidence: __
- [ ] **Repair rehearsal on a live plan**: request repair, confirm one
      transaction (no partial plan), Undo restores exactly, blocked input
      leaves the plan untouched and consumes nothing. Evidence: __
- [ ] **Stripe/webhook reconciliation**: run `/api/cron/billing-reconcile`,
      confirm `ok:true`. Evidence: __
- [ ] **Email outbox**: trigger + confirm delivery, retry and dead-letter
      visibility; verify pause/skip-today suppresses delivery. Evidence: __
- [ ] **AI cost/latency + daily cost ceiling** observed live, now including
      the plan-repair route. Evidence: __
- [ ] **Cron completion**: all crons fire (native + external pingers).
- [ ] **Export/delete** on a test account; confirm no rows remain in the four
      new v8 tables (versions, suppressions, presets, reflections).
- [ ] **Backup restore evidence + rollback drill** (Supabase PITR; redeploy),
      plus flag drill: set `FLAG_PLAN_REPAIR=0` / `FLAG_WEEKLY_REFLECTION=0`
      and confirm the surfaces pause without data loss. Evidence: __
- [ ] **Load test** at beta peak + 3× with provider 429/timeout injection —
      no duplicate billing/generation, no double repair on retry. Evidence: __
- [ ] **Key rotation drill**: rotate `SUPABASE_SERVICE_ROLE_KEY`, app recovers.
- [ ] **Authenticated Playwright suite** with a seeded synthetic user against
      a staging environment. Evidence: __

## 3. Remaining items by severity

| Sev | Item | Owner | Deadline | Mitigation |
|---|---|---|---|---|
| P0 | Live transaction rehearsal not yet run | Primoz | before any invite | none — hard gate |
| P0 | Migrations 027–033 applied to the live project (verify ref vs Vercel URL) | Primoz | before invite | app assumes them |
| P1 | Cron pingers for retention + billing-reconcile not configured | Primoz | week 1 | webhook keeps subs in sync meanwhile |
| P1 | `SUPABASE_SERVICE_ROLE_KEY` rotation pending | Primoz | before paid launch | key only in Vercel env today |
| P1 | Beta experiment plan armed (metrics + stop criteria in `docs/analytics-events-v8.md`) before invites | Primoz | before invite | flags default ON; kill switches tested in drill |
| P1 | Binary PWA PNG icons (192/512) | Primoz | before paid launch | SVG installs fine |
| P1 | Subprocessor DPA/residency + legal-page review with counsel | Primoz | before paid launch | docs/runbooks/privacy-requests.md |
| P1 | Consented beta testimonials (no fabricated social proof) | Primoz | after beta research | none shown until real |
| P2 | Sentry (or equivalent) SDK not installed | Primoz | week 2 | structured logs + health checks |

## 4. Invite cap

Open to **25–50 people** for the first cohort (the v8 beta experiments assume
≤50). Do not widen until section 2 evidence is complete, the daily cost
ceiling has been observed under real usage, and no experiment stop criterion
has fired.

## 5. Rollback triggers

Roll back (redeploy previous commit, or flip the relevant `FLAG_*` kill
switch) or pause invites immediately if any of:

- Any duplicate charge or duplicate generation (including a double-applied
  repair) observed.
- Unsafe AI output or an allergen exclusion miss reaches a user.
- Auth/data exposure of any kind, including sensitive content in analytics or
  email.
- Billing reconciliation cannot reach `ok:true` after one manual run.
- Email delivery failure rate that dead-letters more than a handful of
  messages.
- Sustained plan-repair failure rate, or Undo failing to restore a plan.
- p95 generation latency or provider error rate makes the app unusable and the
  curated fallback is not covering it.

## 6. Verdict

- **Public paid launch: NO-GO.** Section 2 live evidence and the P0/P1 items in
  section 3 are open. Nothing in the v8 code pass changes this — the blockers
  are external configuration and live rehearsal, not code.
- **Small invite-only beta (≤50): CONDITIONAL GO** — permitted once the two P0
  rows are closed, with P1 items tracked to their deadlines, rollback triggers
  armed, and the experiment stop criteria in `docs/analytics-events-v8.md`
  monitored weekly.

Signed: ________________  Date: __________
