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
  `Authorization: Bearer <ADMIN_STATS_SECRET>`: database reachability,
  v6 migrations (020/021), email/Stripe/AI/cron config presence.
  Returns 503 when any component fails; components report only
  ok / fail / not_configured — never details.

Free alerting setup (UptimeRobot or similar):
1. Monitor `https://mellowa.app/api/health` (interval 5 min) — alerts on
   downtime.
2. Monitor `https://mellowa.app/api/health/ready` with the bearer header
   (custom HTTP monitor) — alerts on any failing dependency, including a
   forgotten migration.
3. Alert channel: owner email (free tier is enough for beta).

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

**Status: NOT DONE.** This is P1 in `docs/launch-go-no-go-v10.md` §3 and cannot
be closed by Claude Code or by any test in this repo. Delivery is only
*observed* when a real message arrives in a real inbox.

Fill this in, anonymize anything personal, and paste it into the go/no-go.

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

### 5. Unsubscribe — the path that was completely missing before v10

- [ ] Click the footer opt-out link **from the mail client, signed out**. __
- [ ] Use the mail client's **native** unsubscribe button (Gmail / Apple Mail),
      which exercises the RFC 8058 one-click `POST` path, not the footer link. __
- [ ] Confirm reminders stop and Settings reflects it. Evidence: __

### 6. Failure and backlog

- [ ] Break the provider key deliberately → confirm the row goes
      `failed_transient`, then recovers on the outbox worker. Evidence: __
- [ ] Confirm `/admin` shows backlog and dead-letter counts **without** any
      recipient or content. Evidence: __
- [ ] Confirm a dead letter (5 attempts) stops retrying and stays visible. __

### 7. Lifecycle alignment

- [ ] A `past_due` account receives **no** daily reminder. Evidence: __
- [ ] A canceled account receives **no** daily reminder. Evidence: __
- [ ] Trial-started mail states the **assigned** trial length and charge date
      (MW-V10-02) and matches what pricing showed. Evidence: __

**Sign-off:** reminders may not go to real users until every box above has
recorded evidence.
