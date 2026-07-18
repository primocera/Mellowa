# Support runbook (Launch v6, Prompt 17)

**Support is not crisis monitoring.** Mellowa does not provide emergency or
mental-health support; the in-app safety flow handles crisis language with
region-appropriate resources. If a support email itself contains crisis
content, reply once with the same crisis resources the app shows
(`src/lib/safety/crisis-resources.ts`) and do not counsel further.

## Access

- Console: `/admin/users` — requires a signed-in Supabase session whose user
  id is in `ADMIN_USER_IDS` (Vercel env). Non-admins receive a 404; the URL
  alone grants nothing.
- Identity controls: enable MFA on the Supabase, Vercel, Stripe and GitHub
  accounts (operator action — this is the deployment-appropriate MFA layer;
  there is no separate admin IdP at this scale).
- Every view and action is written to `admin_audit_log` (actor, action,
  target, reason, timestamp) — service-role only, no user access.

## What the console shows / never shows

Shows: account id/email/verification, consent versions, subscription state +
Stripe dashboard link, email delivery statuses, generation outcome metadata,
account flags, audit history.
Never shows: journal text, check-in notes, allergies, mood values, generated
plans. **Break-glass**: if resolving a case truly requires content access, (1)
record the reason first via any console action or a manual
`admin_audit_log` insert, (2) query the minimum rows in the Supabase SQL
editor, (3) note the outcome in the same log. Exceptional by design — the UI
deliberately has no content view.

## Categories, macros, SLA

| Category | First response | Resolution target | Macro |
|---|---|---|---|
| Can't sign in / no verification email | 1 business day | 2 days | "Sorry about that — I've re-sent your verification email; check spam for mail from Mellowa." (Action: Resend verification / Replay failed emails) |
| Billing question / double charge | 1 business day | 3 days | "Thanks for flagging — I'm looking into your billing now." (Flag for billing review; check Stripe dashboard link; refunds per docs/billing-ops) |
| Cancel / refund request | 1 business day | 3 days | Point to Settings → Billing portal; refunds honored per refund policy page. |
| Delete my data | 1 business day | 7 days (GDPR-style) | Self-serve in Settings → Account; verify completion via console (no rows). |
| Bug report | 2 business days | best effort | Thank, reproduce, ticket. |
| Abuse (automation, sharing) | 1 business day | 2 days | Disable generation with reason; explain calmly by email. |

Ownership: Primoz (solo operator) owns all categories. Escalation paths:
billing → Stripe support; privacy/legal → pause the account action, respond
within GDPR windows; safety content in tickets → crisis-resources reply, no
further engagement; engineering → fix on `v6`, note commit in the reply.

## Common cases without SQL or Stripe keys

- **Verification never arrived** → console → Resend verification, or Replay
  failed emails if the ledger shows `failed_transient` / `not_configured`.
- **Paid but app shows free** → console → subscription state vs Stripe
  dashboard link; if drifted, run the reconcile flow (docs/stripe.md) and flag
  billing review.
- **Trial questions** → trial end date is on the subscription card.
- **Suspicious usage** → generations list shows route/status/fallback
  metadata; Disable generation (abuse) with a reason; reversible.
