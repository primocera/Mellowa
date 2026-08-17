# Cron & admin route authentication

All scheduled/operational routes are **fail-closed** (audit v5, Prompt 1):

| Route | Secret env var | Missing secret | Wrong token |
|---|---|---|---|
| `/api/cron/trial-reminders` | `CRON_SECRET` | 503 `not_configured` | 401 |
| `/api/cron/daily-reminders` | `CRON_SECRET` | 503 `not_configured` | 401 |
| `/api/cron/email-outbox` | `CRON_SECRET` | 503 `not_configured` | 401 |
| `/api/admin/stats` | `ADMIN_STATS_SECRET` | 503 `not_configured` | 401 |

No work (DB writes, emails) ever runs without a valid secret. Token comparison
is constant-time; secrets and Authorization headers are never logged.

In production the server refuses to boot when either secret is missing
(`src/instrumentation.ts`). Preview deployments are exempt.

## Vercel setup

Set `CRON_SECRET` in the Vercel project environment — Vercel Cron automatically
sends it as `Authorization: Bearer <CRON_SECRET>` on scheduled invocations.
Set `ADMIN_STATS_SECRET` to a separate random value (e.g. `openssl rand -hex 32`).

## Email outbox worker (v6, Prompt 4)

`/api/cron/email-outbox` replays due retryable deliveries
(`failed_transient` / `not_configured` / `pending`) from `email_deliveries`
with exponential backoff (~5→120 min). It is overlap-safe (`claim_due_emails`
uses SKIP LOCKED with a 10-minute lease), so frequent triggering is fine.

Vercel **Hobby** cron only supports daily schedules and the project already
uses its two cron slots. For timely retries, create a free job on
[cron-job.org](https://cron-job.org) (or any pinger that supports custom
headers):

- URL: `https://mellowa.app/api/cron/email-outbox`
- Method: POST (GET also works)
- Header: `Authorization: Bearer <CRON_SECRET>`
- Interval: every 10–15 minutes

Requires migration `021_mellowa_v6_email_outbox.sql`. Rows created before 021
have no stored payload and are dead-lettered with
`last_error = "no stored payload to replay"` on first claim.

## Health checks and free-tier alerting (v6, Prompt 5)

- `GET /api/health` — public liveness: `{ ok, version }`, no dependencies.
- `GET /api/health/ready` — deep readiness behind
  `Authorization: Bearer <ADMIN_STATS_SECRET>`: database reachability, the
  current-product-line migrations (020/021 **and 044–049**), the exact RPC
  overloads, email/Stripe/AI/cron config presence, and the freshness of the
  deletion and email-outbox workers (MW-04). Returns 503 when a required object
  is missing or (in `READINESS_MODE=paid`) a critical worker is degraded/
  unavailable; components report only ok / degraded / fail / not_configured /
  unavailable — never details.

Free alerting setup (UptimeRobot or similar):
1. Monitor `https://mellowa.app/api/health` (interval 5 min) — alerts on
   downtime.
2. Monitor `https://mellowa.app/api/health/ready` with the bearer header
   (custom HTTP monitor) — alerts on any failing dependency, including a
   forgotten migration.
3. Alert channel: owner email (free tier is enough for beta).

## Background job registry (MW-05)

`src/lib/ops/cron-registry.ts` is the machine-readable source of truth for every
scheduled/operational job. It is verified against the filesystem and `vercel.json`
by `tests/cron-registry-contract.test.ts`, so a route under `src/app/api/cron/`
cannot exist without an entry here, and no entry can name a job whose route is
missing. It stores env-var **names** only — never secret values.

| Job | Route | Method | Secret | Schedule | Lease | Alert if no success |
|---|---|---|---|---|---|---|
| trial-reminders | `/api/cron/trial-reminders` | GET | `CRON_SECRET` | Vercel `0 9 * * *` | cron_leases 10 min | 26 h |
| daily-reminders | `/api/cron/daily-reminders` | GET | `CRON_SECRET` | Vercel `0 8 * * *` | cron_leases 10 min | 26 h |
| email-outbox | `/api/cron/email-outbox` | POST | `CRON_SECRET` | external, every 10–15 min | `claim_due_emails` SKIP LOCKED 10 min | 60 min |
| account-deletion | `/api/cron/account-deletion` | POST | `CRON_SECRET` | external, every 10–15 min | `worker_leased_until` 5 min | 60 min |
| retention | `/api/cron/retention` | POST | `CRON_SECRET` | external, daily | cron_leases 10 min | 50 h |
| billing-reconcile | `/api/cron/billing-reconcile` | POST | `CRON_SECRET` | external, daily | cron_leases 10 min | 50 h |

Vercel Hobby exposes only two native cron slots (used by the two reminder jobs).
The remaining four are driven by an **external pinger** (e.g. cron-job.org) that
sends `Authorization: Bearer <CRON_SECRET>` to the route on the cadence above.

### Trial and daily reminders

Configured in `vercel.json`. Keyset-paginated batches (200) under a `cron_leases`
lease; delivery is idempotent via the email outbox. See the reminder-timing notes
below for the delivery-window contract.

### Account deletion worker

`POST /api/cron/account-deletion` claims due jobs from `account_deletion_requests`
under a 5-minute row lease (`worker_leased_until`) and advances the durable state
machine (`src/lib/account-deletion/{machine,worker,receipt}.ts`). A crash leaves
the job at its last completed milestone with `last_error_code` + `next_attempt_at`;
the expired lease lets it be re-claimed — there is no permanent-failed terminal, so
no partial deletion can send a false completion. Freshness (open/stuck/oldest) is
observed by `account_deletion_stats()` and surfaced in `/api/health/ready`.

### Retention worker

`POST /api/cron/retention` purges completed job rows only after their audit/
minimization window and applies data-retention windows. Daily; idempotent; a
`cron_leases` lease prevents overlap.

### Billing reconciliation worker

`POST /api/cron/billing-reconcile` reconciles local subscription/entitlement state
against Stripe for **owned** (app-namespaced) customers only. Daily; idempotent; a
`cron_leases` lease prevents overlap. It never adopts a foreign-app event (see the
cross-app isolation contract).

### Schedule verification (owner)

The deletion and outbox freshness signals in `/api/health/ready` record whether a
worker has run recently without exposing any secret. To confirm the external pinger
is wired, ping each POST route once with the bearer secret and expect `200`; a `401`
means the secret is wrong, a `503 not_configured` means it is unset.

## Manual testing (replace placeholders, never commit real values)

```sh
# 503 not_configured expected if secret unset; 401 with wrong token
curl -i https://<domain>/api/cron/trial-reminders
curl -i -H "Authorization: Bearer wrong" https://<domain>/api/cron/trial-reminders
# 200 with the real secret
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/trial-reminders
curl -i -H "Authorization: Bearer $ADMIN_STATS_SECRET" https://<domain>/api/admin/stats
```

## Scalable jobs (v6 Prompt 15)

- **Daily reminders** scan profiles with keyset pagination (batches of 200,
  50 s time budget, `truncated: true` when cut short — the next trigger
  resumes; already-reminded users are skipped). Recipient emails come from one
  `get_user_emails` RPC per batch — no per-user auth admin calls.
- **Retention pruning** moved to its own route: `GET/POST /api/cron/retention`
  (Bearer CRON_SECRET). Add a second cron-job.org job for it (daily is
  enough). One job's failure can no longer hide the other's.
- **Outbox metrics**: `/api/cron/email-outbox` responses now include
  `queue: { queued, oldest_due, dead_lettered }` (from `email_outbox_stats`);
  depth > 100 logs an error picked up by log monitoring.
- Requires migration `024_mellowa_v6_jobs.sql` (get_user_emails +
  email_outbox_stats RPCs, reminder scan index).

## What we can and cannot promise about reminder timing (MW-V10-05)

**Vercel Hobby gives one daily cron invocation. It is not a to-the-minute
scheduler, and we must not describe it as one.**

What actually happens for a user whose preferred time is 08:00 local:

| When the daily run happens | Result |
|---|---|
| Before 08:00 local | Handed to Resend as a *scheduled send* for 08:00 local — lands close to the chosen time |
| After 08:00 local | Sent on that run instead — **later** than chosen |
| Never (run missed) | No reminder that day. The next run does **not** back-fill: `last_reminder_sent_date` only advances on a real delivery, and the planner will simply plan today's |

So the guarantees we make are exactly these, and they are what the settings
screen says (`REMINDER_TIMING_DISCLOSURE` in `src/lib/email/reminder-planner.ts`
— one string, shown to the user, asserted by tests):

- **Never earlier** than the chosen time.
- **Sometimes later** in the day.
- **At most one** per local date, on days with no plan yet.

Anything more precise would require a per-minute scheduler we do not have.
Do not "improve" the settings copy to imply otherwise.

### Run leases

`daily-reminders` takes a lease (`claim_cron_run`, migration `038`) so an
overlapping or retried trigger becomes a no-op rather than a second full scan.
This is **not** what prevents duplicate emails — that is the unique
`event_key` on `email_deliveries`, and it works whether or not the lease does.
The lease deliberately **fails open**: if the RPC errors, the run proceeds, so a
problem with the lease table can never silently stop reminders for everyone.

### Who does not get a reminder, and why

All decided in one pure planner (`planReminders`), in this order:

1. **Recent safety signal** (crisis / eating-disorder, last 30 days) — checked
   first so no later rule can decide to send.
2. **Stale or missing consent version** — consent to older copy is not consent
   to current copy. Fails closed.
3. **Billing state that cannot generate** (`past_due`, `unpaid`, `canceled`) —
   nudging them to check in would land on a paywall; the in-app billing recovery
   banner is their route, not an email.
4. Invalid stored timezone · paused · skip-today · already sent today · inside
   quiet hours.

The cron response reports these as **counts by category only** — never a user
id, never content.

---

# Owner live rehearsal — reminders, cron and email

**Status: NOT DONE.** This is `P1-REMINDER-REHEARSAL` in
`docs/launch-go-no-go-v11.md` §3 and cannot be closed by Claude Code or by any
test in this repo. Delivery is only *observed* when a real message arrives in a
real inbox.

Fill this in, anonymize anything personal, and paste it into the go/no-go.

**Stop conditions — abort and record the reason if any of these occur:**

| Condition | Why it stops the rehearsal |
|---|---|
| Two reminders for one local day | The dedupe ledger has failed; at scale this is the complaint that ends a sender's reputation |
| Any mood, energy, meal, journal, allergy, check-in or plan text in a subject or preview | Privacy gate failure — the preview line is visible on a lock screen |
| A reminder arriving **before** the user's chosen local time | The one timing promise the product makes |
| A `past_due` or `canceled` account being nudged toward a paywall | Fixed in v10; a regression here is a trust failure, not a bug |
| An account with a recent safety signal receiving an activity nudge | Safety suppression must outrank every other rule |
| Unsubscribing stopping **billing or account** mail | Those are transactional and must keep arriving; suppressing them is a legal problem, not a preference |

| Field | Value |
|---|---|
| Date (UTC) | |
| Rehearsed by | |
| Environment | production / staging |
| Test account | (synthetic, e.g. `test@…`) |

### 1. Consent and preview

- [ ] Settings shows the **exact** example email before opt-in. Evidence: __
- [ ] Timing disclosure visible next to the time picker ("never earlier…"). __
- [ ] Opting in writes `reminder_consent_version`. Evidence: __

### 2. Delivery in the disclosed window

- [ ] Set a preferred time ~1h ahead, trigger the cron, confirm the mail arrives
      **at or after** the chosen local time, never before. Arrival time: __
- [ ] Subject and body contain **no** mood, energy, meal, journal, allergy or
      plan content. Evidence (screenshot with body visible): __

### 3. Controls take effect before the next send

- [ ] **Pause** → trigger cron → no email. Evidence: __
- [ ] **Skip today** → trigger cron → no email today, email tomorrow. __
- [ ] **Disable** → trigger cron → no email. __

### 4. Idempotency and overlap

- [ ] Trigger the cron **twice in a row**. Exactly one email arrives; the second
      response reports `skipped: already_running` or the send is a ledger
      duplicate. Evidence: __
- [ ] Trigger again after the lease TTL (90 s): still exactly one email for the
      day. Evidence: __
- [ ] **Isolate the dedupe KEY, not the lease or an empty scan (MW-V12-04).**
      The v11 attempt was inconclusive because the second firing scanned zero
      rows — the account had unsubscribed, so it proved nothing about the ledger
      key. To prove the key: keep the account **eligible on both runs** and let
      the lease expire between them, so the second run genuinely re-scans the
      account and the planner would deliver again. Reset
      `last_reminder_sent_date` to null before the second run (mimicking the
      post-send write failing), fire again after the lease TTL, and confirm the
      ledger event key — `daily_reminder:<user>:<local-date>` — reports the
      second send as a **duplicate** while the scan was non-empty. Evidence: __
      The deterministic form of this is `tests/reminder-reliability.test.ts`
      ("two eligible cron runs send once — the DEDUPE KEY holds"); the live run
      confirms it against the real ledger.

### 5. Unsubscribe — the path that was completely missing before v10

- [ ] Click the footer opt-out link **from the mail client, signed out**. __
- [ ] Use the mail client's **native** unsubscribe button (Gmail / Apple Mail),
      which exercises the RFC 8058 one-click `POST` path, not the footer link. __
- [ ] Confirm reminders stop and Settings reflects it. Evidence: __

### 6. Failure and backlog

Observe the full failure path in a **safe test account** — do not break the live
provider for real users. Use a deliberately wrong `RESEND_API_KEY` (or a Resend
test key that rejects) so the failures are yours alone.

- [ ] **Transient failure → retry/backoff → final success (MW-V12-04).** With
      the key broken, trigger a send: the row goes `failed_transient` with a
      `next_attempt_at` in the future and a stored `last_error` (a redacted
      provider reason, never the body). Fix the key; the outbox worker retries
      on its backoff schedule (~5, 10, 20, 40, 80 min ±20%, capped 2 h) and the
      row finalizes `sent`. Evidence: __
- [ ] **Permanent failure → dead-letter.** Leave the key broken (or force a 4xx)
      across `MAX_ATTEMPTS` (5): the row becomes `failed_permanent`, clears
      `next_attempt_at`, and stops retrying. Evidence: __
- [ ] Confirm the stored `last_error` carries the provider's reason with the
      address redacted, and no message body, health input or secret. Evidence: __
- [ ] Confirm `/admin` shows backlog and dead-letter counts **without** any
      recipient or content. Evidence: __

The deterministic forms of every transition above live in
`tests/email-delivery.test.ts` and `tests/email-outbox.test.ts` (transient
retry, bounded attempts, dead-letter, backoff, jitter); the live run confirms
the same states against the real provider and ledger. Do not claim live success
from the mocks.

### 7. Lifecycle alignment

- [ ] A `past_due` account receives **no** daily reminder. Evidence: __
- [ ] A canceled account receives **no** daily reminder. Evidence: __
- [ ] Trial-started mail states the **assigned** trial length and charge date
      (MW-V10-02) and matches what pricing showed. Evidence: __

### 8. Unsubscribe suppresses the right mail, and only the right mail

The one-click opt-out covers *activity* mail. Billing and account mail is
transactional: the user is entitled to it and suppressing it would be both a
product failure and a legal one. `src/lib/email/categories.ts` is the single
place that decides which is which.

- [ ] After unsubscribing from reminders, trigger a **billing** email (e.g.
      cancel the test subscription) → it still arrives. Evidence: __
- [ ] Confirm the suppression is recorded per category, not as a global block on
      the address. Evidence: __
- [ ] Re-enable reminders from Settings → reminders resume, and the earlier
      suppression does not silently persist. Evidence: __

### 9. Cleanup

Do this whether the run passed or aborted.

1. Disable reminders on the synthetic account so nothing keeps sending.
2. Restore the provider key if step 6 broke it deliberately, and confirm the
   backlog drains to zero.
3. Clear any dead letters created by the run, or record why they remain.
4. Confirm `/admin` delivery health shows no backlog attributable to the run.

**Sign-off:** reminders may not go to real users until every box above has
recorded evidence.

**What this rehearsal cannot prove, and is not asked to.** DST correctness,
quiet-hours wrapping past midnight, consent-version enforcement and safety
suppression are covered by fixtures in `tests/reminder-reliability.test.ts`,
because reproducing them live would mean waiting for a DST boundary or putting a
crisis signal on a real account. The rehearsal proves *delivery*: that a real
message reaches a real inbox, at the right time, saying the right thing, and
that the controls stop it.

---

## Durable cron run ledger + external-pinger verification (MW-05)

Every registered job now runs through one shared helper (`src/lib/ops/run-cron-job.ts`)
that records a durable row in `cron_runs` (migration 053): `job_id`, `run_id`,
`status` (running / success / failure / skipped_locked / lease_unavailable / degraded),
timings, `processed` count, a **safe error category** (never a message, id, address or
content), the lease outcome and the release SHA. `retention` and `billing-reconcile` now
also acquire the registry's `cron_leases` lease through the helper with a **fail-closed**
policy — a run whose lease cannot be evaluated **skips** rather than risk a duplicate
prune or a duplicate live-Stripe reconcile.

**Where to look**
- Machine: `select * from public.cron_job_health();` — last run/success/failure per job.
- Admin: `GET /api/admin/cron-runs` — per-job health, the 50 most recent runs (status /
  category / counts only) and a `neverRun` list of registered jobs with **no** ledger row
  yet (a scheduler that was never configured is visible, not silently absent).
- Readiness: `/api/health/ready` reads `cron_job_health()` and turns each critical job's
  last success into `cron_retention_freshness` / `cron_billing_reconcile_freshness`. A
  configured pinger with **no observed success** is `unavailable` and fails paid closed.

**Owner external-pinger checklist (NOT RUN by Claude — owner-only).** For each
external job (`email-outbox`, `account-deletion`, `retention`, `billing-reconcile`),
configure the free pinger (cron-job.org) with:

| Field | Value |
|---|---|
| Method | `POST` |
| URL | `https://mellowa.app/api/cron/<job>` |
| Header | `Authorization: Bearer <CRON_SECRET>` (never commit the value) |
| Cadence | email-outbox/account-deletion: every 10–15 min · retention/billing: daily |
| Timeout | 60 s |
| Alert | notify on non-2xx (the routes return 500 on exceptions on purpose) |

**Verify after configuring (owner):**
1. Trigger each job once; confirm a `success` row appears in `GET /api/admin/cron-runs`.
2. Trigger `retention`/`billing-reconcile` twice within the lease window; the second must
   record `skipped_locked` (never a double run).
3. Confirm `/api/health/ready` (paid mode) reports `cron_*_freshness: ok` only **after** a
   real success — not before.

Live pinger configuration and delivery observation remain **owner-only, NOT RUN**.
