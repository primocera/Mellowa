# XAPP-V17-02 — Mellowa launch decision (read/verify/decide)

Separate scores and verdicts, no averaging across apps or dimensions, blocker
caps applied **before** numerical scoring. This is the Mellowa half; the Scalvya
table and any shared decision live in `primocera/LaunchBloom` (owner-run). This
document authorizes nothing to deploy, charge, refund or acquire — it records what
is earned by evidence and what is still owner-observed.

**Candidate SHA:** `4e7e19d` (branch `v17`, **not yet frozen** — freeze is
owner-run per `MW-V17-10-FREEZE-AND-SCORE.md`).

## Mellowa scores

| Dimension | Score | Verdict | Blockers / caps | Evidence | Next action (owner) | Revalidate when |
|---|---|---|---|---|---|---|
| Product capability | ~9.0 | strong | none (P0-LIVE is owner-gated, not a code defect) | 1562/1562 unit, 81 eval, 73-page build, prod audit 0, v17 privacy/deletion/portal/onboarding/isolation hardening | — | on any product-code change |
| Capped-beta readiness | **≤ 8.9 → UNASSESSED** | not yet | no frozen candidate; authenticated core journeys not observed at a frozen SHA | RC lifecycle + preflight ready; auth matrix runnable (MW-V17-01) | Freeze via RC workflow, then run the authenticated matrix at that SHA | after freeze + authed run |
| Public-paid readiness | **7.9 → NO-GO** (CONDITIONAL for a bounded launch under the accepted P0) | conditional | open `P0-LIVE-TRANSACTION` caps < 8; live-money lifecycle, deployed readiness, mature renewal/cohort all unobserved | contract tests green; P0 owner-accepted carry-forward | Observe live-money lifecycle + deployed readiness + a mature cohort | after each owner observation |

Under-five, stale, missing and not-yet-mature data are PENDING/UNAVAILABLE — never
zero, never PASS. Thresholds are predeclared and not changed after seeing data.

## 14-day bounded launch plan (capped beta)

- **Day 0:** owner freezes the candidate (RC workflow) and runs the authenticated
  matrix at the frozen SHA; confirm deployed readiness `ready=true`.
- **Days 1–14:** bounded intake (≤ the beta-capacity switch; keep it small).
  Daily: monitoring + safety/billing rollback ready, support owner named,
  kill-switch criteria live. Weekly: cohort review against
  `COHORT-METRIC-DICTIONARY.md` (D2/D3, repair, Week, first renewal) — report
  maturity, never a premature zero.
- **Stop conditions:** any open dispute; any billing/privacy/safety P0/P1; stale
  or missing analytics; any under-five cell used as a result.
- **Do not** authorize acquisition expansion before the gates pass and the cohort
  matures.

## What would earn 9.5 (missing OBSERVED evidence only — not more features)

- Capped-beta 9.5: exact frozen candidate; all automated gates green at that SHA;
  observed authenticated core journeys; deployed readiness `ready=true`;
  monitoring/rollback/support owner; bounded intake + stop controls; no open
  beta-impact P1.
- Public-paid 9.5 additionally: complete observed real-money lifecycle with no
  unexplained billing incident; mature predeclared repeat-value + first-renewal
  evidence. A runbook or validator alone is **not** evidence.

## Non-negotiables

No points for documentation volume, test count alone, configured-but-unobserved
providers or synthetic data. Internal scores/interviews are never converted into
public claims or testimonials without consent and review. Product quality is high
while public-paid stays conditional — that is the honest state, not a contradiction.
