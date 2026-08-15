# MW-12 — Lifecycle catalog as the executable source of truth

**Outcome:** Every user email has one trigger, consent class, dedupe key and suppression rule.
**Verdict:** completed (code + tests). No migration.

## Before

`src/lib/email/lifecycle-catalog.ts` declared all 12 messages (purpose, trigger,
consent class derived from `EMAIL_CATEGORIES`, dedupe key, suppression) but had
**no importer** — the delivery pipeline (`deliverEmail`) accepted any `template:
string` and never resolved it through the catalog.

## Change

- **`lifecycle-catalog.ts`**: added `isDeliverableTemplate(template)` and
  `messageSpecFor(template)` — the delivery gate.
- **`src/lib/email/deliver.ts`**:
  - `deliverEmail` now resolves the template through the catalog **before any
    ledger write or provider call**; an unknown template is refused
    (`failed_permanent`, categorical log) and never queued or sent.
  - `replayDeliveries` (outbox worker) dead-letters a row whose template is no
    longer in the catalog — a retry resolves to the same catalog entry, never an
    unregistered message.

Consent class stays derived from the single `EMAIL_CATEGORIES` registry, so the
catalog can never disagree with it. All 12 templates are wired to real callers
(daily-plan, reminders, welcome, cancel, webhook, auth callback, deletion worker) —
no catalog-only phantom.

## Tests

- `tests/lifecycle-catalog-wiring.test.ts` (new, 8):
  - consent-class parity catalog ↔ `EMAIL_CATEGORIES` both directions (no drift);
  - `deliver.ts` gates on `isDeliverableTemplate`;
  - `deliverEmail` refuses an unknown template without touching the ledger/provider,
    and accepts a registered one;
  - every `template: "…"` literal across all eight production caller files is
    registered;
  - optional-consent callers pass `unsubscribeUrl`;
  - `allowlistedDeepLink` accepts only internal allowlisted paths (rejects offsite,
    protocol-relative and non-allowlisted).
- Existing `email-delivery`, `lifecycle-catalog`, `email-outbox`, `lifecycle-emails`
  suites unchanged and green.

## Invariants preserved

- Idempotent ledger delivery, bounded retries, `not_configured` never counted as
  sent — unchanged.
- Neutral, non-medical copy with no wellbeing content in subject/preview/provider
  metadata — still enforced by the existing `lifecycle-emails` test.

## Rollback

Revert the `deliver.ts` gate + the catalog helpers + the new test.
