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

## Manual testing (replace placeholders, never commit real values)

```sh
# 503 not_configured expected if secret unset; 401 with wrong token
curl -i https://<domain>/api/cron/trial-reminders
curl -i -H "Authorization: Bearer wrong" https://<domain>/api/cron/trial-reminders
# 200 with the real secret
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/trial-reminders
curl -i -H "Authorization: Bearer $ADMIN_STATS_SECRET" https://<domain>/api/admin/stats
```
