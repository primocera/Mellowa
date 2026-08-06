# v16 — truth freeze & bounded gap register (MW-95-00)

**This is not a source of launch truth.** Canonical launch truth remains
`docs/launch-go-no-go-v11.md` (FROZEN at `745b4a4`) and the current release
packet `docs/release/v15/STATUS-AND-DECISION.md`. The machine-validated v16
manifest is produced by MW-95-02, not here. This file only (a) records the drift
corrected in MW-95-00 and (b) classifies the verified gap each v16 prompt closes,
so no later prompt re-sells owner-gated work as code work.

## Baseline

| | Value |
|---|---|
| Repository | `primocera/Mellowa` |
| v16 branch base (`main` = merged v15) | `432ed18235bf473bd2e38fcbc7546213536d4175` |
| v15 candidate (historical) | `bb08786` |
| Rollback target (v14 product line) | `6fe3980` |
| Migrations on disk | `001`–`042` (highest `042_mellowa_v13_subscription_currency`) |

`origin/main` verified equal to `432ed18` at freeze time; no drift.

## Drift corrected in MW-95-00 (Scalvya content that leaked into Mellowa docs)

`PROMPT_PACK_SCOPE_NOTE.md` was a verbatim Scalvya copy. Every item below was
verified **absent** from this repository and corrected to the real Mellowa
mechanism:

| Was referenced | Reality in Mellowa | Fixed in |
|---|---|---|
| `docs/launch/launch-state.json`, `docs/LAUNCH_STATE.md` | do not exist; launch truth is `docs/launch-go-no-go-v11.md` + `docs/release/v15/STATUS-AND-DECISION.md` | scope note |
| candidate `b234dad`, rollback `81993ff` | Scalvya SHAs; Mellowa base `432ed18`, candidate `bb08786`, rollback `6fe3980` | scope note |
| `test:e2e:auth` | no such script; auth matrix is `test:e2e:matrix` (`scripts/run-auth-matrix.mjs`) | scope note, v15 packet §3 |
| `rehearsal:validate`, `rehearsal-record.json` | no such script/file; live-money rehearsal is `docs/runbooks/live-transaction-rehearsal.md`, recorded into `docs/launch-go-no-go-v11.md` §3 | scope note, v15 packet §3 + §9 |
| react-router advisory `GHSA-qwww-vcr4-c8h2`, `check:router` | Mellowa is Next.js App Router with **no** `react-router`/`vite`; dep advisories are resolved by upgrade in `docs/security-next-advisories-v13.md` | scope note, v15 packet §3 |

No historical manifest was rewritten. `docs/release/manifest.v13.json` remains
`superseded`; `docs/release/manifest.v11.json` is unchanged.

## Verified v16 gap classification

Each row was checked against HEAD `432ed18`. Only verified gaps are built.

| Prompt | Verified gap | Classification |
|---|---|---|
| MW-95-01 | `src/app/api/stripe/checkout/route.ts` reuses `row.stripe_customer_id` (line ~99) and adopts a concurrent `confirmRow.stripe_customer_id` (line ~180) **without** retrieving/validating Customer ownership; `findMellowaCustomer` search/create are already correct | **open defect** (code) |
| MW-95-02 | `manifest.v13.json` superseded; no current machine-validated v16 manifest; the authenticated CI job can pass on absent secrets unless the mutable `RC_GATE` var = 1 | **release-truth defect** (code) |
| MW-95-03 | `docs/beta-scorecard.md` predeclares D2/D3, plan_repair_previewed, preview→apply, Week opened, carry-forward, support burden, trial→charge, renewal, refund — several not computed in `report.ts`; no `plan_repair_previewed` event; `onboarding_completed` is client-describable | **open defect** (code) |
| MW-95-04 | `AppNav` marks a hub active only on `pathname.startsWith(hub.href)`, so detail routes can show no active parent; layout `navEntitlement` maps unknown/unavailable billing status to `free` | **open defect** (code) |
| MW-95-05 | `onboarding-wizard.tsx` persists the full Draft (allergies, severe-allergy flag, stress/sleep/energy baseline) to `localStorage`; `onboarding_completed` is browser-tracked | **open defect** (code + privacy) |
| MW-95-06 | Recurring paid-value jobs (adapt today / reuse / carry-forward) lack an integrated weekly decision view tying them to conversion/renewal/support evidence | **product-value gap** (partly owner-observed) |
| XAPP-95-01 | Cross-app ownership matrix must add the durable-DB-link and concurrent-winner negative paths after MW-95-01 | **open defect** (code, verification) |
| XAPP-95-02 | Evidence-based non-compensating re-score; separate Product / Capped-beta / Public-paid verdicts | **audit** (no new features) |

## Owner gates — cannot be closed by any v16 prompt

These remain open and are only satisfied by an owner action at the exact
candidate SHA. No v16 prompt may mark them green or re-scaffold tooling for them:

- `P1-AUTH-E2E-AT-HEAD` — authenticated E2E matrix (`test:e2e:matrix`) against a
  throwaway non-production Supabase, pinned at the candidate SHA.
- `P0-LIVE-TRANSACTION` — one real charge → cancel → reactivate → recover →
  refund, per `docs/runbooks/live-transaction-rehearsal.md`, recorded into
  `docs/launch-go-no-go-v11.md` §3.

The single highest-value next step remains **marketing / traffic to
mellowa.app**, then deploying the capped beta — neither of which a prompt can do.
