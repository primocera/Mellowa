# MW-11 — Privacy-safe support ingestion and support-burden truth

**Outcome:** Support load becomes measurable without storing message content.
**Verdict:** completed (defect fix + coverage gate + docs + tests).

## What already existed (v18 MW-V18-08)

- `support_tickets` (migration 047): **metadata only** — external_ref, dedupe_key,
  account_user_id, category, severity, product_area, plan, channel, status,
  reopened_count, timings. No subject/body/email/content by schema.
- `POST/GET /api/admin/support-tickets`: idempotent audited import + aggregate
  burden; closed-set taxonomy (`z.enum`, unknown category **fails validation**,
  `other` is explicit not a fallback); staff/test/demo excluded; dedupe by issue.
- `supportBurden` wired into the analytics report.

## The defect MW-11 fixes

`supportBurden` returned `state: contacts === 0 ? "measured" : "measured"` — a
no-op ternary. An **empty ledger read as "measured, 0 contacts" (a fabricated
zero)** even when the inbox is active but nothing is being ingested. MW-11
forbids exactly this.

## Change

- **`src/lib/support/metrics.ts`**: added `ingestionVerified?: boolean` input.
  An empty ledger is now **UNAVAILABLE** unless ingestion coverage is verified
  (`if (contacts === 0 && !ingestionVerified) return unavailable`); a read error
  still wins as unavailable. A non-empty ledger is measured.
- **`report.ts`** and **`api/admin/support-tickets` GET**: pass
  `ingestionVerified: process.env.SUPPORT_INGESTION_VERIFIED === "1"` (defaults
  false → safe unknown). The GET also returns `coverage: { ingestionVerified,
  ledgerRows }` — the reconciliation aid (compare against inbox items reviewed)
  without any content leaving the inbox.
- **`docs/support-runbook.md`**: documented the ingestion process — channels,
  the content-free import contract, the `SUPPORT_INGESTION_VERIFIED` gate, and
  the reconciliation flow.

## Tests

- `tests/support-burden.test.ts` (+6 MW-11 cases): empty ledger without verified
  ingestion → unavailable (not zero); empty + verified → measured zero; non-empty
  → measured regardless; read error still unavailable; unknown category fails
  validation; `other` is a valid explicit category.
- Existing `support-burden` / `admin-support` suites unchanged and green.

## Owner actions

- Wire the inbox → ledger import (admin API is documented); set
  `SUPPORT_INGESTION_VERIFIED=1` only after confirming coverage; reconcile
  periodically against `coverage.ledgerRows`.

## Rollback

Revert the metrics/report/route changes and the doc/test additions; the additive
`ingestionVerified` input is optional (defaults false).
