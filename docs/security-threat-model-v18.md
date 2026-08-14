# Mellowa threat model (MW-V18-X06)

Prioritised, product-specific threat model for a paid, single-tenant-per-user
wellbeing SaaS on Next.js App Router + Supabase (Postgres/RLS) + Stripe. This is
an engineering threat model, **not** a compliance certification.

## Assets & trust boundaries

| Asset | Boundary | Primary control |
|---|---|---|
| User wellbeing data (check-ins, plans, journal) | Postgres, per-user | RLS `auth.uid() = user_id`; service-role server-only |
| Identity / sessions | Supabase Auth | httpOnly cookies; server verifies `getUser()` |
| Billing (subscriptions, customers) | Stripe + `subscriptions` | Webhook signature; customer-ownership guard; app-namespace isolation |
| Secrets (service role, Stripe, AI, cron) | Server env only | Never imported in `"use client"`; redaction in logs |
| AI provider payloads | External provider | Minimised prompts; no journal/mood free-text injected |

## Prioritised abuse cases → control (and where it's enforced)

| # | Abuse case | Control | Enforced |
|---|---|---|---|
| P0 | Cross-account data access (IDOR) | RLS on every user table; server authz per route | migrations + route `getUser()` |
| P0 | Webhook forgery | Stripe signature verify + app-namespace isolation | `stripe/webhook`, `xapp-isolation` tests |
| P0 | Deletion failure leaving residual data | Durable state machine verifies residual counts | MW-V18-04 machine + tests |
| P0 | Server secret leakage to the browser | No secret env in client bundles | X06 security-contract test |
| P1 | Prompt injection via user text | Free text treated as data, never instructions; delimited, capped | `safety/check-input`, `ai/output-guards` |
| P1 | Rate / cost abuse | Per-user hourly/daily caps + global spend ceiling (fail-closed) | `ai/fair-use`, `ai/rate-limit` |
| P1 | Account enumeration | Uniform auth responses; admin routes 404 to non-admins | admin routes `requireAdmin → 404` |
| P1 | Open redirect / deep-link abuse | Relative-path allowlist only | `email/lifecycle-catalog.allowlistedDeepLink` |
| P2 | Token leakage in logs | Central redacting logger drops emails/tokens/keys | MW-V18-X02 `observability/log` |
| P2 | Supply-chain (action/dep drift) | SHA-pinned actions + Dependabot; `npm audit` = 0 | MW-V18-07 |
| P2 | Support-data over-collection | Ledger stores category/severity only, no message body | MW-V18-08 |

## Data lifecycle

- **Inventory**: the authoritative user-data list is `src/lib/privacy/registry.ts`
  (export + deletion + contract test derive from it).
- **Retention**: `RETENTION_RULES` (safety excerpts 180d, analytics 365d, failed
  email 90d); deletion jobs purged after retention (MW-V18-04/05).
- **Deletion propagation**: cascade for owned tables; anonymise (SET NULL) for
  `app_events` and `support_tickets`; deletion job outlives the identity (no FK).
- **AI provider retention**: minimise payloads; provider retention settings need
  owner confirmation (owner action, not code).

## Residual / owner items (not closeable in code)

- Provider data-retention attestations (AI, email, Stripe).
- A live penetration test of tenant isolation at the deployed edge.
- CSP report-only → enforce rollout verification in production.

These are recorded here honestly; they are **open** owner tasks, not "closed".
