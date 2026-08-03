# MW-P1-06 — Owner-only production rehearsal runbook (v13)

**Claude Code executes none of this.** No live charge, refund, migration, key
rotation, or destructive action was performed. This is the owner procedure with
prerequisites, safe commands, expected evidence, abort conditions and rollback.

## Evidence rules (apply to every step)

- **observed_live** = the owner personally observed the named production event
  and attached redacted evidence. Only then may the manifest read `live_rehearsed`.
- **observed_test_mode** (Stripe test clock / non-prod) is **not** live evidence
  and never becomes it.
- **blocked / accepted_risk** stays visible; it is never renamed "closed".
- No personal payment instrument or customer account is used without explicit
  owner approval.
- **Redact before attaching any evidence:** customer email, full card, Stripe
  customer/subscription/payment IDs (keep last 4 only), webhook signing secret,
  any journal/plan text, any secret value. Screenshots: crop to the row in question.

## Preconditions (once, before any step)

- Owner account only; the approved production Stripe account + the Mellowa prod
  Supabase project. Confirm you are on the **v13 candidate SHA** (the one MW-FINAL
  pins), not `745b4a4`.
- Rollback lever available: `FLAG_MONTHLY_FAIR_USE=0`, `FLAG_PLAN_REPAIR=0`,
  `FLAG_WEEKLY_REFLECTION=0`, `FLAG_TRIAL_LENGTH_EXPERIMENT=0`, `LAUNCH_MODE`
  toggle. All migrations are additive/re-runnable — no reversal needed to roll back.

---

## Step 1 · Read-only release + price + secret verification

- **Owner / env:** owner, production env pulled locally (never printed).
- **Action (safe, read-only):**
  ```
  npm run release-check          # presence only; never prints a secret value
  npm run verify-prices          # asserts live prices read back 999/5999 EUR
  node scripts/secret-fingerprint.mjs   # one-way identity check, no value
  ```
- **Expected evidence:** release-check exit 0; verify-prices exit 0 with
  `999 eur/month`, `5999 eur/year` on a EUR-default account; fingerprints match
  the recorded ones.
- **Abort / rollback:** any mismatch → STOP, do not proceed to billing. No mutation
  occurred, so nothing to roll back.
- **Max time to recovery:** n/a (read-only).

## Step 2 · Migration status for 040/041 (and any later)

- **Action (read-only):** hit `GET /api/health/ready` with the ops bearer; or run a
  read-only `select` for the `reminders_unsubscribed_at` column (040) and the
  `web_vitals` table (041).
- **Expected evidence:** `ready` returns 200; both objects present. (Manifest
  already records 040/041 applied 2026-08-01 — this step re-confirms.)
- **Abort:** if absent, the app fails those two paths closed (tolerated) but the
  unsubscribe surface / vitals insert are degraded — apply the migration in a
  maintenance window before launch. **Do not auto-apply here.**

## Step 3 · Minimal approved live billing lifecycle

Follow `docs/runbooks/live-transaction-rehearsal.md`. Small real purchase at the
**displayed** €9.99 price/currency.

- **Expected per sub-step (redacted):** checkout charges €9.99 EUR Succeeded →
  `customer.subscription.created` webhook 200 → DB `subscriptions` row active,
  entitlement granted → portal reachable → cancel at period end (access retained)
  → reactivate (NO second charge) → refund → `charge.refunded` 200 → post-refund
  entitlement expectation per policy.
- **Abort signal:** displayed price ≠ charged price/currency, a second unexpected
  charge, or entitlement not matching the event → STOP, refund by hand, set
  `LAUNCH_MODE` back to closed.
- **Max time to recovery:** manual refund + entitlement fix ≤ 15 min while cohort
  is small and owner-contactable.
- **Status:** charge/cancel/reactivate/refund already **observed_live** 2026-08-01.
  Re-run only if the v13 code changed a billing path (it did not).

## Step 4 · Failure → recovery and late/out-of-order event (test clock)

Live cards cannot be forced to decline on demand, so use the **Stripe test clock /
test mode** per `docs/runbooks/billing-order-test-clock.md`.

- **Expected evidence:** payment failure → `past_due` → recovery → active; then a
  genuinely-older `payment_failed` delivered AFTER a newer recovery is **ignored**
  by the created-order guard (`src/lib/stripe/event-order.ts`), leaving the customer
  active.
- **Evidence class:** **observed_test_mode** — records the P0-LIVE-TRANSACTION
  steps 5–6 residual; it does **not** convert the accepted risk to closed.

## Step 5 · Reminder duplicate-eligible cron + forced provider failure

Follow the worksheet at the end of `docs/ops-cron.md` and the queries in
`docs/runbooks/reminder-rehearsal-queries.sql`. **Do not send real customer
reminders** — use an owner/test recipient.

- **Expected evidence:** the same reminder made eligible twice is suppressed by the
  dedupe **key** (not the lease, not an empty scan) → one send. A forced transient
  provider failure → retry/backoff → success; a forced permanent failure → dead
  letter, then recovery. Duplicate-cron run produces no second email.
- **Abort / rollback:** duplicate email actually sent → disable the reminder cron
  (unset the schedule) and investigate the dedupe key before re-enabling.
- **Max time to recovery:** disable cron ≤ 5 min.

## Step 6 · Key rotation & isolated restore (rehearsal only)

Follow `docs/runbooks/key-rotation-and-backup.md` and `restore-verification.sql`.
**Do not rotate live keys in this pass** unless the owner explicitly decides to;
the deliverable is a measured drill.

- **Expected evidence:** per-secret rotation with overlap + validation + rollback,
  no secret value printed (use `secret-fingerprint.mjs`); an isolated restore into
  a **non-production** target with a measured wall-clock **RTO** and **RPO**, plus
  integrity checks. Never overwrite production.
- **Status:** P1-ROTATION-RESTORE remains **accepted_risk** until the drill runs;
  tested RTO/RPO stay blank until measured.

---

## Manifest write-back (owner)

For each step actually observed, set the matching `ownerEvidence` status:
`live_rehearsed` (steps 1–3, already recorded), test-clock note for step 4,
`live_rehearsed`/`not_run` for steps 5–6 per what was observed. Keep every
un-run item `blocked`/`not_run`. Re-confirm the four accepted risks before the
paid cohort scales. The `tests/release-truth-consistency.test.ts` gate will fail
CI if a human summary later contradicts these statuses.
