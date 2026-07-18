# Privacy request handling (Launch v6, Prompt 24)

**Owner:** Privacy request owner (Primoz). **Escalation:** data-protection
counsel for anything ambiguous or cross-border.

## GDPR-style workflow

Applies to access, deletion (erasure) and correction requests.

1. **Receive & log.** Requests arrive at the support/privacy inbox. Record in
   `admin_audit_log` via `/admin/users` (flag/view is audited) or a manual note.
2. **Verify identity.** The requester must prove control of the account email
   (respond from it, or complete an emailed verification). Never act on an
   unverified third-party claim. Do not over-collect ID.
3. **Fulfil:**
   - **Access** → user self-serves *Settings → Account → Export* (paginated
     export of every registry table). For an assisted export, use the same
     endpoint; never hand-assemble from raw tables.
   - **Deletion** → user self-serves *Settings → Account → Delete*, which
     cancels Stripe first, then cascades all personal data; a deletion
     confirmation email is sent before the auth user is removed. Verify via the
     console that no rows remain.
   - **Correction** → most fields are user-editable in onboarding/settings; for
     anything else, correct the specific row and note it.
4. **Deadline.** Acknowledge within 3 business days; complete within **30 days**
   (GDPR one-month rule), extendable once with reason. Delete requests: 7-day
   internal target.
5. **Processor coordination.** If a copy may persist with a processor
   (Supabase, Stripe, Resend, AI provider), confirm their deletion/retention
   honours the request; see the subprocessor list below.

## What operators may see — and may not

Routine triage uses **metadata only** (`/admin/users`): account, subscription,
delivery status, generation outcomes, audit history. Operators must **never**
inspect journal text, check-in notes, allergies, mood values or generated
content for routine work. Content access is an audited break-glass exception
(docs/support-runbook.md), recorded before access.

## Subprocessors (review with counsel before paid launch)

| Processor | Purpose | Data | DPA / residency to confirm |
|---|---|---|---|
| Supabase | Auth + Postgres | account, profile, plans | DPA signed; region pinned |
| Stripe | Billing | email, payment metadata | DPA; PCI handled by Stripe |
| Resend | Transactional email | email address, message | DPA; EU processing |
| AI provider | Plan generation | check-in inputs (no identity) | DPA; no training on data |
| Vercel | Hosting | request logs | DPA; data residency |

**Action (pre-paid-launch):** review each DPA, data-residency/transfer
safeguard (SCCs where applicable) and the subprocessor list with the privacy
owner/counsel. This document is the checklist, not evidence that the review is
complete.
