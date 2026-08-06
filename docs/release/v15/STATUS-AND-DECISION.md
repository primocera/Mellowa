# Mellowa — v15 launch-closure status & decision packet

Covers MW-06 (candidate + verdict) and XAPP-02 (decision packet), Mellowa side.
Scalvya is a separate repository and is not opened in this session; its prompts
were run by the owner in `primocera/LaunchBloom`, and its verdicts belong to that
repo's packet. **No deploy, migration, Stripe mutation, email or live rehearsal
was performed here.**

## 1. Candidate

| | Value |
|---|---|
| Branch | `v15-launch-closure` |
| Candidate HEAD | `bb08786` |
| Rollback (last shipped product line, v14) | `6fe3980` (= `main`) |
| Migrations on disk | `001`–`042` (highest: `042_mellowa_v13_subscription_currency`) |
| Drift vs candidate | product code + tests + active docs only; no historical manifest rewritten |

v15 commits on top of `main`: MW-02, MW-03, MW-01, XAPP-01, and one MW-01
follow-up test fix. These are **defect fixes and verification**, not new scope.

## 2. Automated gate results (run in this session)

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ clean |
| Typecheck | `npx tsc --noEmit` | ✅ clean |
| Unit/contract tests | `npx vitest run` | ✅ **1393 passed / 115 files**, 0 skipped-as-green |
| Production build | `npm run build` | ✅ compiled |

Evidence is reproducible at candidate `bb08786`.

## 3. Owner / environment-gated gates — NOT run here (honest status)

None of these can be closed by a prompt; recording them as anything but
`not_run`/`blocked` would be fabricating a pass. This is exactly what
`PROMPT_PACK_SCOPE_NOTE.md` warns against, and v15 deliberately did **not**
re-scaffold them.

| Item | Status | Closes only when… |
|---|---|---|
| Authenticated E2E matrix (`npm run test:e2e:matrix`, `scripts/run-auth-matrix.mjs`; public journeys `test:e2e:public` / `test:e2e:journey`) | **blocked (no non-prod env here)** | owner runs it once against a throwaway non-production Supabase and pins the pass at the candidate SHA |
| Live-money rehearsal (A–H) | **not_run** | owner runs the ordered sequence on real Stripe per `docs/runbooks/live-transaction-rehearsal.md` and records the result into `docs/launch-go-no-go-v11.md` §3 (`P0-LIVE-TRANSACTION`) |
| Next.js dependency advisories | **resolved by upgrade** (`docs/security-next-advisories-v13.md`) | already patched (Next 16.2.12 + transitive overrides); Mellowa has no `react-router`, so no router advisory applies |
| `npm run eval`, `npm audit --omit=dev`, `npm run release-manifest` | **not_run this session** | owner runs on the release machine when cutting the machine-validated manifest |

## 4. Blockers

**Closed / improved by v15 (code + tests):**
- Duplicate-customer footgun on the shared Stripe account → **closed** (MW-02).
- Paying user mislabeled Free/Sample during a billing outage; unavailable read
  granting a sample → **closed** (MW-03).
- Owner runbooks quoting retired €9.99/€59.99 → **closed**, guarded by a contract
  test (MW-01).
- Cross-app Stripe isolation → **strengthened + documented** (XAPP-01).

**Still open (owner-gated, unchanged by design):**
- `P1-AUTH-E2E-AT-HEAD` — authenticated matrix at the candidate SHA.
- `P0-LIVE-TRANSACTION` — one real charge→cancel→reactivate→recovery→refund.

## 5. Verdicts

- **Mellowa capped invite-only beta — CONDITIONAL GO.** Nothing in v15 blocks it;
  the fixes only make it safer. It needs a **deploy (LAUNCH-01)**, not more
  evidence. Conditions: bounded invite cohort (≤ ~50), the named accepted risk
  (`P1-AUTH-E2E-AT-HEAD`), and the monitoring/rollback plan in §6.
- **Mellowa unrestricted public paid — NO-GO.** Gated on the two owner-run items
  in §3 (authenticated matrix + live-money rehearsal). No old acceptance is
  carried forward automatically. GO is impossible while an accepted risk remains.

## 6. 72-hour monitoring & rollback triggers (beta)

Watch (all thresholds deliberately low for a small cohort):
- `adoptedSubscriptions` in any reconcile report → **any** = webhook drop.
- Duplicate-customer detections → **any**.
- `customer_reconciliation_required` / `customer_link_failed` 503s → investigate.
- Email dead letters / outbox backlog past one send window → **any**.
- AI daily-ceiling denials during the run → **any**.

Rollback (operational, no revert needed): `FLAG_PLAN_REPAIR=0`,
`FLAG_TRIAL_LENGTH_EXPERIMENT=0` (pinned trials still complete as disclosed), and
close intake via the beta-capacity switch. Code rollback target: `6fe3980`.

## 7. Four-week value-proof scorecard (no vanity metrics)

Privacy-safe aggregates only — **never** mood, health, allergy, journal or plan
content as a growth metric:
- Sample completion; next-day and next-week return.
- Adjust usage; Undo usage; completed-item preservation rate.
- Weekly reflection use; trial-to-paid; 30-day retention.
- Refund and cancellation **reason categories** (not free text).

Thresholds without cohort evidence are **hypotheses**, labelled as such. A green
build is not proof people will pay; a beta verdict does not authorize public paid.

## 8. The honest bottom line — THE #1 JOB IS MARKETING

**The product is done. The single most important thing now is MARKETING —
getting real people to mellowa.app.** Not another prompt pack, not more billing
hardening, not more evidence machinery. Those are finished. What moves the
business from here is **traffic and users**, full stop.

The product and its safeguards are essentially complete; **what's missing is
users, not code.** The two remaining paid-launch gates are owner actions in the
real world — chiefly running the authenticated E2E matrix against a throwaway
Supabase (≈ one afternoon) plus the live-money rehearsal — and the capped beta is
ready to **deploy** now. But even those are secondary to the real bottleneck:

> **Priority order: (1) MARKETING / traffic to mellowa.app, (2) ship the capped
> beta, (3) the owner's two live gates for public paid.** Everything a prompt
> pack can build here already exists (see `PROMPT_PACK_SCOPE_NOTE.md`: do not
> re-open the same three items).

## 9. Recommendation & exact remaining owner actions

**Recommendation — Mellowa: MARKET IT. Then continue/ship the capped beta.**

In order:
1. **MARKETING / traffic acquisition to mellowa.app — the #1 priority.** This is
   the actual bottleneck; the product is ready for the people it needs.
2. Review this branch's diff; merge `v15-launch-closure` (owner).
3. **Deploy the capped beta** (LAUNCH-01) with the bounded invite cohort.
4. Run the **authenticated E2E matrix** against a throwaway non-production
   Supabase; pin `passed_locally` at the candidate SHA.
5. Run the **live-money rehearsal** (A–H) on real Stripe per
   `docs/runbooks/live-transaction-rehearsal.md`; record the result into
   `docs/launch-go-no-go-v11.md` §3.
6. Only after 4 + 5 are recorded, cut the machine-validated manifest and
   re-evaluate the **public-paid** verdict.

Prompts cannot do 3–6; they are owner actions. No prompt can do 1 either — that
is real-world go-to-market work, and it is what matters most right now.
