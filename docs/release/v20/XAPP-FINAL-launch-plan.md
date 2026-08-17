# XAPP-FINAL — coordinated two-app launch plan (no coupled release truth)

> Scalvya and Mellowa share one Stripe account and shared operational providers,
> but have **different remaining blockers, separate product promises and separate
> repeat-value evidence**. This plan protects the shared blast radius while
> keeping each app's code, data, candidate, evidence, cohort and rollback
> **independent**. Owner-executed; no launch date is assigned here without owner
> confirmation and completed prerequisites.

## Staged sequence (independent entry/exit per app)
1. **Internal synthetic** — seeded, no real users; the app's own automated + RC
   evidence green.
2. **Invited capped beta** — a small invited cohort (Mellowa: the existing beta
   cap, enforced by migration 039). Entry: RC promoted + migrations applied +
   authenticated matrix at the candidate SHA. Exit: no P0 incident over the
   observation window.
3. **Bounded public paid** — a small, manually-capped paying cohort. Entry: paid
   readiness observed + the live billing rehearsal recorded (MW-09). Exit: no
   billing incident; entitlement/refund correct.
4. **Unrestricted paid** — only after a clean bounded-paid observation window.
5. **Small acquisition expansion** — a manual, bounded increment, gated by the
   canonical `scaleDecision` (MW-06): mature cohort, verified support, pricing
   discovery open, zero disputes, measured capacity. Never automatic.

## Shared blast-radius controls
- **Stripe webhook endpoints:** each app owns only its `app`-stamped objects
  (XAPP-01); a foreign event is acknowledge-and-drop.
- **Provider spend / email sender reputation / owner support capacity:** shared;
  a problem in either pauses the shared surface, not just one app.

## Hard rules
- **A GO in one app cannot close a blocker in the other.** Separate candidate
  SHAs, migration receipts, readiness receipts, live-money evidence and cohort
  decisions.
- **Never open both public-paid launches simultaneously.** The second app
  requires an observation window on the first and **no shared-provider incident**.
- **No automatic cap or ad-spend increase.** Every increment is a manual owner
  decision.
- **Any cross-app billing/provider incident stops BOTH paid expansions** until
  reconciled (one shared incident escalation).

## Owner dashboard (side by side, never averaged)
| Dimension | Scalvya | Mellowa |
|---|---|---|
| Candidate SHA | (own) | v20 branch HEAD |
| Migrations applied | (own) | 050–054 NOT RUN |
| RC promoted | (own) | NOT RUN |
| Auth matrix at SHA | (own) | NOT RUN |
| Live billing rehearsal | (own) | NOT RUN (P0-LIVE carried) |
| Isolation (XAPP-01) | (own) | PASS at v20 SHA |
| Scale decision | (own) | HOLD |
| Pause switch | per-app | per-app |

## Scenario responses (tested contract)
- **Scalvya healthy, Mellowa blocked →** only Scalvya's tier advances; Mellowa holds.
- **Shared Stripe incident →** both paid expansions stop until reconciled.
- **One app weak value but stable ops →** hold only that app's acquisition.
- **Owner support capacity exceeded →** no second launch wave starts.

## Per-app pause switches
- Mellowa: `FLAG_PLAN_REPAIR=0`, `FLAG_WEEKLY_REFLECTION=0`, beta-capacity intake
  switch, per-surface UI reverts. External pinger disable stops the cron jobs.
- Scalvya: its own documented switches (separate repo).

## Next single owner action per app
- **Mellowa:** apply migrations 050–054 to a disposable Supabase and verify
  (`docs/release/v20/MIGRATION_PLAN.md`), then cut the RC.
- **Scalvya:** per its own final plan (separate repo/SHA).
