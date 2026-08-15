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

## Ledger ingestion (MW-11) — measuring support burden without storing content

The `support_tickets` ledger measures **how much** support each area costs
without ever storing **what** anyone wrote. The inbox stays the source of the
messages; only content-free metadata enters the ledger.

**Channels.** Contacts arrive via the `mailto:` support / refund / privacy links
in the app's legal config, monitored daily.

**How a contact enters the ledger** (`POST /api/admin/support-tickets`, admin-only):
- Send only: `external_ref` (provider message id, optional), `dedupe_key` (a
  stable per-issue id — repeated mails about one issue reconcile to one row),
  optional `account_user_id`, `category`, `severity`, `product_area`, `plan`,
  `channel`, `status`, response/resolution timestamps.
- **Never** send subject, body, attachment, email address, or any wellbeing/
  medical detail — the request schema rejects unknown keys, and an unknown
  `category` fails validation (it is never silently mapped to `other`).
- Re-importing the same `external_ref` updates the row (idempotent); every import
  is audited. Safety / billing / deletion / privacy categories require human
  review — never auto-resolve them.

**Reading burden.** `GET /api/admin/support-tickets` returns the aggregate burden
over mature cohorts (staff/test/demo excluded) plus `coverage: { ingestionVerified,
ledgerRows }`.
- Burden is **UNAVAILABLE** (not "zero") while the ledger is empty and ingestion
  is not verified — an active inbox with an empty ledger means nothing is being
  imported yet, which is *unknown*, not *no load*.
- Set `SUPPORT_INGESTION_VERIFIED=1` in the environment **only after** you have
  confirmed the inbox is being imported into the ledger. Then an empty ledger
  reads as a genuine measured zero.

**Reconciliation.** Compare the number of inbox items you reviewed for the period
against `coverage.ledgerRows` (raw imported rows) and `burden.contacts` (deduped
by issue). A large gap means ingestion is incomplete — burden should stay
UNAVAILABLE until it closes. No message content is needed to do this.

## Common cases without SQL or Stripe keys

- **Verification never arrived** → console → Resend verification, or Replay
  failed emails if the ledger shows `failed_transient` / `not_configured`.
- **Paid but app shows free** → console → subscription state vs Stripe
  dashboard link; if drifted, run the reconcile flow (docs/stripe.md) and flag
  billing review.
- **Trial questions** → trial end date is on the subscription card.
- **Suspicious usage** → generations list shows route/status/fallback
  metadata; Disable generation (abuse) with a reason; reversible.
