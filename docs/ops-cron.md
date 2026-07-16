# Cron & admin route authentication

All scheduled/operational routes are **fail-closed** (audit v5, Prompt 1):

| Route | Secret env var | Missing secret | Wrong token |
|---|---|---|---|
| `/api/cron/trial-reminders` | `CRON_SECRET` | 503 `not_configured` | 401 |
| `/api/cron/daily-reminders` | `CRON_SECRET` | 503 `not_configured` | 401 |
| `/api/admin/stats` | `ADMIN_STATS_SECRET` | 503 `not_configured` | 401 |

No work (DB writes, emails) ever runs without a valid secret. Token comparison
is constant-time; secrets and Authorization headers are never logged.

In production the server refuses to boot when either secret is missing
(`src/instrumentation.ts`). Preview deployments are exempt.

## Vercel setup

Set `CRON_SECRET` in the Vercel project environment — Vercel Cron automatically
sends it as `Authorization: Bearer <CRON_SECRET>` on scheduled invocations.
Set `ADMIN_STATS_SECRET` to a separate random value (e.g. `openssl rand -hex 32`).

## Manual testing (replace placeholders, never commit real values)

```sh
# 503 not_configured expected if secret unset; 401 with wrong token
curl -i https://<domain>/api/cron/trial-reminders
curl -i -H "Authorization: Bearer wrong" https://<domain>/api/cron/trial-reminders
# 200 with the real secret
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/trial-reminders
curl -i -H "Authorization: Bearer $ADMIN_STATS_SECRET" https://<domain>/api/admin/stats
```
