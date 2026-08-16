# Note to the prompt-pack author — stop re-selling owner-gated work as code work

**Read this before writing the next pack (v16+).** As of v19 the engineering line
is done and certified — the next pack should be the **v20 "Moving Toward Marketing"
pack**, not engineering; see [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md). This note is Mellowa-only
(`primocera/Mellowa`). It previously carried Scalvya/LaunchBloom paths, candidate
SHAs and a react-router advisory that **do not exist in this repository**; those
were corrected in the v16 truth-freeze (MW-95-00). Every file, script, candidate
and verdict named below is a real Mellowa artifact.

> **Hard rule, up front:** if the pack you are about to write has as its *spine*
> the **authenticated E2E matrix** or the **live-money rehearsal**, **do not
> write it.** Both are owner-gated, already inventoried in the canonical launch
> truth, and cannot change status from a prompt. A pack whose only new content is
> another way to describe one of these two is a no-op. Stop and tell the owner to
> run the two live tasks (or deploy the beta) instead. The same restraint applies
> to dependency/security advisories: they are closed by an upgrade + a recorded
> check (see `docs/security-next-advisories-v13.md`), not by re-scaffolding.

The packs v11 → v15 kept circling the **same owner-gated items**: the
authenticated E2E matrix and the live-money rehearsal. Each new pack
re-inventories them, adds more machinery *around* them, and ships. That is
motion, not closure — and it cannot become closure, because **neither of these
can be closed by a prompt.** They are gated on an owner action in the real world.
Writing them into another pack produces another green build that describes the
same gap more precisely.

This note draws the line between **real work** (keep doing) and **churn** (stop).

---

## The recurring owner-gated items — why a pack can never close them

| Item | Real Mellowa mechanism | Closes *only* when… |
|---|---|---|
| **Authenticated E2E matrix** | `npm run test:e2e:matrix` (`scripts/run-auth-matrix.mjs`); public journeys are `test:e2e:public` / `test:e2e:journey` | the owner runs it once against a **throwaway non-production Supabase** and pins the pass at the candidate SHA |
| **Live-money rehearsal** (A–H) | `docs/runbooks/live-transaction-rehearsal.md`, result recorded into `docs/launch-go-no-go-v11.md` §3 (risk `P0-LIVE-TRANSACTION`) | the **owner** runs the ordered sequence on real Stripe and records it in the runbook + go/no-go doc |

> **Note on the "router advisory."** Earlier copies of this note referenced a
> react-router 7.x advisory (`GHSA-qwww-vcr4-c8h2`) and an `npm run check:router`
> guard. **Neither applies to Mellowa:** this is a Next.js App Router app with no
> `react-router` (or `vite`) dependency. Mellowa's dependency advisories are the
> Next.js line, resolved by upgrade and documented in
> `docs/security-next-advisories-v13.md`. Do not re-import the react-router item.

Both live items are **owner-gated by design**. Claude Code correctly refuses to
run them (no live money, no production DB seeding). So a pack that "addresses"
them can only add scaffolding — validators, guards, matrices, runbooks — which is
what v13/v14/v15 each did. **The scaffolding is complete.** The next status
change is an owner *doing* the task, not a pack describing it.

### The rule for the next pack

> Do **not** open a new prompt whose spine is the E2E matrix or the live-money
> rehearsal. A pack may reference them; a pack may **not** re-implement tooling
> for them. If a pack's only new content is another way to describe one of these,
> don't write the pack.

---

## What *was* real (this is the work worth doing)

Not everything was churn. These were genuine defect fixes with genuine value —
this is the kind of thing a pack *should* contain:

- **v14** — billing fails closed on trial/customer uncertainty; billing errors
  redacted (no `err.message`, no full-email logs).
- **v15 MW-02** — idempotent Stripe customer creation + read-only orphan
  recovery (fixes a real duplicate-customer footgun on a shared Stripe account).
- **v15 MW-03** — a paying user in a billing-read outage is no longer mislabeled
  Free/Sample and is never offered a second trial.
- **v15 XAPP-01** — cross-app Stripe isolation (Mellowa never adopts a
  Scalvya-owned customer/subscription/charge; `app=mellowa` namespace).

The test is simple: **did the pack fix or prevent a real defect, or did it
re-describe a gap that only the owner can close?** Ship the first. Skip the second.

**v16 assessment:** v16's spine is *not* the two owner-gated items. It closes
real defects — Stripe Customer ownership on the stored-row and concurrent-winner
paths (MW-95-01), machine-validated release truth with an immutable RC gate
(MW-95-02), an executable cohort-correct beta scorecard (MW-95-03), coherent
four-hub navigation + honest billing-unavailable state (MW-95-04), privacy-safe
resumable onboarding + server-confirmed first value (MW-95-05), and recurring
paid-value evidence (MW-95-06). It references the owner gates without
re-scaffolding them. That is on the right side of the line.

---

## Where the launch actually stands (so the next pack starts from truth)

Canonical launch truth: `docs/launch-go-no-go-v11.md` (FROZEN at `745b4a4`) and
the current release packet `docs/release/v15/STATUS-AND-DECISION.md`. v15 is
merged to `main` (`432ed18`); the v15 candidate was `bb08786`, rollback target
`6fe3980` (the v14 product line).

- **Capped beta: CONDITIONAL GO.** Nothing in code blocks it. It needs a
  **deploy** (LAUNCH-01) and a bounded invite cohort (≤ ~50), not more evidence.
  The two owner-gated items above do **not** gate the beta.
- **Public paid: NO-GO.** Gated on exactly the two items above (authenticated
  matrix + live-money rehearsal) — and they convert to "satisfied" only by owner
  action, never by a pack.

**Therefore:** the highest-value next step is not another pack. It is (a) deploy
the capped beta, or (b) the owner spends one afternoon closing the E2E matrix and
the live-money rehearsal — and, above both, **marketing / traffic to
mellowa.app**, which no pack can do. Another pack about the same two items does
not move the product forward.

---

*If you're about to write a pack and its spine is "finish the E2E matrix / re-run
the live-money rehearsal / re-examine a dependency CVE" — stop. That pack already
shipped. Point the owner at the two real tasks and at marketing instead.*

---

## v17 addendum — don't re-list these two as per-version owner chores (but they are NOT "closed")

> **Machine truth is authoritative.** This note is guidance for pack authors; it
> never overrides `docs/release/manifest.v16.json` and its generated
> `docs/release/v16/STATUS.md`. The v18 reconciliation (MW-V18-01) corrected an
> earlier version of this addendum that called both items "closed-by-policy":
> neither is *closed*. One is an **open, owner-accepted** risk; the other is an
> **open** blocker satisfied automatically at freeze. "Accepted" and "auto-run at
> freeze" are not "closed" — a superseded run is never a standing closure.

The owner is done re-doing these every release, but that is about *not making them
recurring manual chores* — not about marking them done. For v18/v19/etc.:

- **`P0-LIVE-TRANSACTION` is OPEN and owner-accepted (carry-forward), never
  closed** — the acceptance lives in `manifest.v16.json.acceptedRisks` and keeps
  the blocker open in `manifest.v16.json.blockers`; it lifts public paid to
  CONDITIONAL GO, never GO. The owner does **NOT** re-run real payments per
  version. Never re-open it as fresh live-money work, never write it as a *new*
  blocker, never ask for another live charge except the single pre-scale re-verify
  the acceptance already names. Live rehearsal costs real money each time — that
  recurring cost is exactly what the owner refuses to keep paying. But do not
  present it as done: it is an accepted risk, and accepted risk is not completion.
- **`P1-AUTH-E2E-AT-HEAD` is a free automated test that is OPEN at HEAD, not an
  owner chore and not closed.** It is `npm run test:e2e:matrix` in Stripe TEST
  mode (no real money). v17 MW-V17-01 wired `release-candidate.yml` to run it
  automatically **when** the GitHub seeded-env secrets exist, at the frozen
  candidate SHA. The prior a59aa4e run passed (93/0/27) but is **superseded** by
  the v17 product-code drift, so it no longer certifies HEAD — the candidate model
  correctly requires it re-observed at the candidate. Either CI runs it at freeze,
  or the owner ships capped-beta under a *recorded* accepted risk on it (as v14
  did). Do NOT tell the owner to hand-run it or rebuild a throwaway Supabase per
  release; equally, do NOT mark it closed just because it ran once at an old SHA.

If the next pack's owner-action list contains "re-run the E2E matrix" or "do a
live transaction" as *fresh manual work per release*, that framing is wrong —
point instead at the freeze workflow (E2E) and the single recorded acceptance
(live money). But never record either as *closed*: the manifest keeps them open
and honest, and no prose here may say otherwise.

---

## v18 outcome — the pack shipped; the next move is NOT another pack

**v18 is merged to `main` and deployed.** All 25 code prompts (M01–M18 + X01–X07)
landed on branch `v18`, fast-forwarded onto `main` (`190cee7..476b591`), plus a
follow-up security fix (`6ef291f`). The owner has completed the required ops:

- **Migrations 044–048 applied and verified in production Supabase** — durable
  account-deletion ledger (044), canonical cohort facts + exclusion registry
  (045), onboarding provenance columns (046), privacy-safe support ledger (047),
  and the security-invoker fix for `analytics_activation_facts` (048, which
  cleared the Supabase "SECURITY DEFINER view" linter finding).
- **Account-deletion worker cron is wired and live** (external pinger →
  `/api/cron/account-deletion`, Bearer `CRON_SECRET`, verified `200 OK`).
- **Supabase security advisors are clean.**

What remains is **owner-gated and optional**, never a code pack: seeding
`analytics_excluded_users`, running the onboarding backfill, importing support
tickets, and the standing O01–O04 (auth E2E rehearsal, live-money re-verify,
capped-beta window, promotion memo). The two live items above are still OPEN and
honest in the manifest — do not mark them closed.

> **The highest-value next move is NOT another code pack — it is deploy +
> marketing / getting real users onto mellowa.app.** The product side is solid
> and shipped. Every pack from v11 forward has reached this same conclusion, and
> v18 reaches it from a stronger position: the app is live, migrated, and its
> ops (deletion cron, cohort facts, support ledger) are running. Writing a v19
> code pack to add more machinery around an already-complete product is churn.
> If a pack must be written, its spine must be a **real, newly-discovered
> defect** — not more scaffolding, not the two owner-gated live items, and not a
> restatement of "measurement/observability" that X01–X07 already delivered.
> Otherwise: **stop, and tell the owner to get users in.**
