# v20 owner-live rehearsals — checklist + evidence schema (MW-09)

**Every step here is executed by a human against the live (or, where noted,
disposable) project.** Claude Code never moves real money, sends real email,
deletes production accounts, or configures external schedulers. It prepared this
runbook and the evidence validator (`src/lib/release/rehearsal-evidence.ts`); it
does not run the rehearsals.

**Evidence hygiene.** Record opaque identifiers only — Stripe object ids
(`sub_…`, `pi_…`, `re_…`), event keys, run ids, timestamps, statuses. Never an
email address, card number, token, plan/check-in content, or a screenshot
showing them. The validator rejects any artifact containing those.

**Evidence artifact shape** (one JSON per gate, validated before the gate closes):
```
{ "gate": "billing", "candidateSha": "<the frozen RC SHA>",
  "environment": "production", "startedAt": "...", "completedAt": "...",
  "steps": [ { "id": "charge", "observedAt": "...", "status": "pass", "receipt": "pi_…" }, ... ] }
```
`validateRehearsalEvidence` refuses stale SHA, wrong environment, a missing
transition, a billing run with no refund, a zero-test synthetic claim, and any
PII/card/token content.

---

## Billing — STOP on any duplicate charge, entitlement mismatch or missing refund
Steps: price_disclosure → checkout → trial → charge → cancel_at_period_end →
reactivation → failure → recovery → late_failure → refund.
- Confirm the **current public price/charge disclosure** matches checkout.
- Verify entitlement after each transition (trial active, cancel retains until
  period end, recovery restores).
- **Refund happens on every run** (cleanup), passed or aborted.
- **STOP conditions:** a duplicate charge, an entitlement mismatch, a mis-ordered
  failure/recovery, or a missing refund. Rollback: refund + cancel immediately.

## Email — STOP on a sensitive subject/preview or a wrong unsubscribe
Steps: sender_verified → welcome_delivery → no_sensitive_preview →
category_unsubscribe → billing_mail_unaffected.
- Verify sender/domain/config; a welcome/transactional mail arrives.
- No wellbeing content in subject or preview.
- Category unsubscribe suppresses that category only; billing/account mail is
  unaffected.
- **STOP conditions:** a sensitive subject/preview, or an unsubscribe that
  silences billing/account mail. Rollback: pause the category sender.

## Reminder — STOP on an early reminder or a duplicate
Steps: consent_version → chosen_local_time → never_earlier → pause_skip_disable →
two_runs_dedupe → dst_boundary.
- Reminder fires at the chosen local time, **never earlier**; pause/skip/disable
  honored; two eligible runs dedupe through the event key; DST boundary correct.
- **STOP conditions:** any reminder earlier than the chosen time, or a duplicate
  send. Rollback: disable reminders for the account.

## Outbox — STOP on a lost permanent failure or leaked content
Steps: transient_retry_success → permanent_dead_letter → backlog_visible_no_content.
- Transient failure retries with backoff to success; permanent failure dead-
  letters; backlog/readiness visible **without recipient or content**.
- **STOP conditions:** a permanent failure that neither delivers nor dead-letters,
  or any recipient/content in the backlog view.

## Cron — STOP on a missing durable run or a double run
Steps: invoke_all_external_jobs → durable_run_record → overlap_no_op.
- Invoke every external job with the correct bearer header; confirm a durable
  `cron_runs` success (MW-05) and that a second overlapping invoke is a
  `skipped_locked` no-op. Confirm paid readiness `cron_*_freshness=ok` only after
  a real success.
- **STOP conditions:** no durable run record, or a second run that processes the
  same work. Rollback: disable the pinger.

## Deletion — STOP on a partial deletion reported complete
Steps: request → leased_worker_progress → stripe_cancellation → data_deletion →
receipt → retry_after_crash → no_false_complete.
- Request → leased worker progress → Stripe cancellation → data deletion/
  anonymization → receipt; a crash mid-run retries; a partial deletion is **never**
  reported complete.
- **STOP conditions:** any partial deletion returned as success. Rollback: re-queue
  the deletion job.

## Cross-app safety (shared Stripe)
A **foreign-app** Stripe fixture (Scalvya / unknown `app` metadata) presented to
Mellowa's webhook/ownership path must cause **zero** Mellowa mutation, entitlement
change or lifecycle email — acknowledge-and-drop only. Proven in code by
`tests/xapp01-shared-stripe-isolation.test.ts` (MW-XAPP-01); the live rehearsal
confirms no Mellowa side effect when a foreign event arrives.

## What remains OWNER-ONLY (NOT RUN)
Live Stripe money, real inbox delivery, external pinger configuration, and
production account deletion. Claude prepared the validators/runbooks only.
