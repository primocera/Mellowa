# Runbook — key rotation and backup/rollback drill

**Owner-run.** Claude Code must never execute any step here: every one mutates
live Supabase, Stripe, Resend or Vercel. Claude prepares the commands; a human
runs them and records anonymized evidence.

**Status vocabulary:** *configured* (set, never exercised) · *rehearsed live*
(a human ran it against production) · *observed* (seen in real traffic). A drill
that was not run is a blocker, never a pass.

---

## A. Why this is a launch gate

Every secret below can be leaked by a single mistake — a screenshot, a pasted
log, a misconfigured preview deployment. If rotation has never been rehearsed,
the response to a real leak is improvised under time pressure, and the usual
outcome is a partial rotation that locks out paying users while leaving the
leaked credential live somewhere.

The service-role key is the sharpest: it bypasses RLS entirely. Treat its
exposure as a full data-access incident, not a config change.

## B. Rotation order (dependencies first)

Rotate one credential per pass and verify before starting the next. Doing them
together makes it impossible to tell which one broke a failure.

Each secret has its own procedure below — they differ in how the overlap works
and what a wrong rotation breaks. Rotate strictly in this order; the dependency
order exists because a broken earlier rotation must not hide behind a later one.

| # | Secret | Owner | Where it lives | Overlap: can old + new both be valid? | Blast radius if rotated wrong |
|---|---|---|---|---|---|
| 1 | `CRON_SECRET` | Owner | Vercel env + `vercel.json` cron headers | Yes — accept either during the window by design, or accept brief 401s | Reminders and reconciliation stop silently |
| 2 | `ADMIN_STATS_SECRET` | Owner | Vercel env, uptime monitor | Yes | Readiness monitoring goes blind |
| 3 | `EMAIL_UNSUBSCRIBE_SECRET` (app signing secret) | Owner | Vercel env (HMAC key for one-click unsubscribe tokens; falls back to `CRON_SECRET`) | **No** — HMAC verifies one key, so rotation invalidates outstanding unsubscribe links | Previously-sent unsubscribe links stop verifying |
| 4 | `RESEND_API_KEY` | Owner | Vercel env, Resend dashboard | Yes — create a second key before revoking | All transactional mail stops |
| 5 | `AI_PROVIDER_API_KEY` | Owner | Vercel env, provider console | Yes | All plan generation fails closed |
| 6 | `STRIPE_WEBHOOK_SECRET` | Owner | Vercel env, Stripe dashboard (endpoint signing secret) | **Partial** — Stripe issues a new signing secret per endpoint; roll the endpoint and update env together | Webhooks fail signature verification → entitlement sync stops |
| 7 | `STRIPE_SECRET_KEY` (API key) | Owner | Vercel env, Stripe dashboard (API keys) | Yes — Stripe supports roll with an overlap window | Checkout and server-side Stripe calls break |
| 8 | `SUPABASE_SERVICE_ROLE_KEY` | Owner | Vercel env, Supabase dashboard | Yes on legacy keys; JWT-signing-key rotation has its own overlap in Supabase | Everything server-side; rotate last, most carefully |

**Preconditions for every rotation:** a green `npm run release-check` and
`/api/health/ready` beforehand (so a pre-existing failure is not blamed on the
rotation), the Vercel dashboard open on Production env, and the provider console
open on the credential. Record the **fingerprint** of the current value first
(section C) so the change is verifiable afterwards.

### Per-secret procedure (the general shape)

1. Create the **new** credential in the provider without deleting the old one.
   Both must be valid at once — this is what makes the change reversible. Where
   overlap is not possible (the two **No/Partial** rows above), schedule the
   rotation for a low-traffic window and expect the stated breakage until the
   redeploy lands.
2. Update the Vercel environment variable for Production.
3. Redeploy. Vercel does not re-read env vars in a running deployment.
4. Verify (section C), including a **fingerprint change**, **before** revoking
   the old credential.
5. Revoke the old credential in the provider.
6. Record: date, secret name, who ran it, verification result, and the
   before/after fingerprints. **Never record the value, or any prefix or suffix
   of it** — the fingerprint is the only identifier that is safe to write down.

If verification fails at step 4, roll back by reverting the Vercel variable and
redeploying. The old credential is still live, so this always works — which is
the entire reason for the overlap.

**The two no-overlap secrets need their own handling:**

- `EMAIL_UNSUBSCRIBE_SECRET` — HMAC verifies exactly one key, so rotating it
  makes every unsubscribe link already in someone's inbox fail. That is
  tolerable because the links are re-minted on every reminder send, so the next
  reminder carries a working link; but do it in a quiet window and note that a
  user clicking an old link between rotation and their next reminder gets the
  "this link didn't work" page, which still points them to Settings. Never
  remove the `CRON_SECRET` fallback without first setting an explicit value.
- `STRIPE_WEBHOOK_SECRET` — Stripe binds the signing secret to the endpoint.
  Update the endpoint and the env var together; verify with a Stripe test event
  (section C) before revoking anything. A wrong value here silently drops every
  webhook, which is the "paid but no access" failure by another route.

## C. Verification after each rotation

```bash
# Presence and shape only — never prints a value.
npm run release-check

# One-way fingerprint — confirms the DEPLOYED value is the NEW one, without
# ever printing the secret (MW-V12-05). Run before and after the rotation and
# compare; a changed fingerprint proves the new value is live. Pull the prod
# env first (vercel env pull), then:
node scripts/secret-fingerprint.mjs --env .env.production.local CRON_SECRET \
  STRIPE_WEBHOOK_SECRET STRIPE_SECRET_KEY RESEND_API_KEY \
  EMAIL_UNSUBSCRIBE_SECRET SUPABASE_SERVICE_ROLE_KEY

# Deep readiness, including the v9 RPC overloads (MW-V10-00).
curl -s -H "Authorization: Bearer $ADMIN_STATS_SECRET" \
  https://<app-domain>/api/health/ready | jq
```

The fingerprint is presence *and identity*: presence alone (`release-check`)
cannot tell a stale value from the intended one — exactly the class of gap that
let a USD price pass an EUR presence check. Confirm the fingerprint **changed**
after the rotation and **matches** the new value you generated.

Expect every component `ok`. Specifically confirm
`rpc_claim_ai_generation_v035` and `rpc_undo_plan_repair_v034` are `ok`: a
`fail` there means the database this deployment is pointed at does not have the
overloads the app calls, and the first user generation after the deploy would
500.

Then, per secret:

- `CRON_SECRET` — trigger the cron route manually with the new bearer; expect
  200 and a sane JSON summary. With the **old** secret expect 401.
- `RESEND_API_KEY` — send one lifecycle mail to a disposable owner address.
- `STRIPE_WEBHOOK_SECRET` — send a test event from the Stripe dashboard and
  confirm it is recorded `done` in `stripe_events`, not `failed`.
- `SUPABASE_SERVICE_ROLE_KEY` — load `/api/health/ready` (it uses the admin
  client) and complete one signed-in page load.

## D. Backup and rollback drill

Supabase's automated backups are worthless until a restore has actually been
performed once. Rehearse on a **separate project**, never on production.

1. Note the current production backup timestamp in the Supabase dashboard.
2. Create a scratch Supabase project.
3. Restore the most recent production backup into the scratch project.
4. Point a local `.env.local` at the scratch project and run the app.
5. Confirm: a user row loads, a plan renders, `/api/health/ready` returns all
   `ok` (this proves migrations `034`/`035` are inside the backup, not applied
   manually afterwards).
6. Record the wall-clock time from step 3 to step 5. **That number is the real
   recovery-time objective** — the dashboard's promise is not.
7. Delete the scratch project.

### Restore verification — check these, not just "the app loaded"

A restored database that renders one page proves very little. Each row below is
a thing that has to survive a restore for the product to be safe rather than
merely running. Compare against the production counts you noted at step 1.

| Check | Why it matters | Result |
|---|---|---|
| Row counts per user-owned table match production ±the backup window | Silent truncation is the failure nobody notices until a user asks where their week went | __ |
| Every restored row's `user_id` still resolves to an auth user | Orphaned rows are a privacy problem: they belong to nobody and RLS cannot protect them | __ |
| `reminder_consent_version` values survive | Consent is fail-closed; if it restores as NULL the user must re-consent, which is safe but is a real behaviour change to know about | __ |
| Allergy and dietary fields on `wellbeing_profiles` are intact | These are the hard safety gate. A partial restore here is the one that could hurt someone | __ |
| `subscriptions` rows map to the same Stripe ids | A restore that loses the mapping means paying users without access | __ |
| Deletion tombstones are still deleted | If a restore resurrects an account the user asked to erase, that is a data-protection incident, not a rollback | __ |
| `daily_plan_versions` and their snapshots restore together | A version without its snapshot makes Undo lie | __ |

Use counts, hashes and ids for evidence. Do not paste plan contents, check-ins
or journal text into this file.

**Run these checks, don't eyeball them.** `docs/runbooks/restore-verification.sql`
is a read-only script covering every row above — run it against the **scratch**
project (never production) and paste the anonymized counts into the Result
column. It only ever `SELECT`s; it creates and changes nothing.

### RTO and RPO — tested versus desired

State these separately and never let the second stand in for the first.

| | Desired | Tested | Measured on |
|---|---|---|---|
| RTO (time to a working restore) | ____ | ____ | ____ |
| RPO (acceptable data loss window) | ____ | ____ | ____ |

**Until the Tested column is filled, this project has no RTO or RPO** — it has
an intention. The Supabase plan's stated backup frequency sets an upper bound on
RPO but proves nothing about RTO.

### What is not in the backup

Restoring the database does not restore the product. These must be recreated or
re-pointed by hand, and a drill that skips them will report a faster recovery
than a real incident would deliver:

- Environment variables and secrets in Vercel (see section B for the inventory).
- Stripe objects — customers, subscriptions and prices live in Stripe, not here.
  A database restore can therefore disagree with Stripe; the reconcile job is
  what brings them back together, and it should be run immediately after.
- Scheduled jobs (Vercel cron and the external pinger) and their secrets.
- Email provider configuration, domain verification and suppression lists.
- Anything in the outbox that had already been handed to the provider: those
  messages were sent and will not be un-sent by a restore.

### How account deletion propagates

Worth rehearsing in the same drill, because it is the inverse operation and the
one with legal weight. Deletion goes through the registry in
`src/lib/privacy/registry.ts`, which is the single list of user-owned tables. A
restore that predates a deletion **reinstates data the user asked to remove**,
so after any restore into a live-facing environment, re-apply deletions
requested since the backup timestamp before opening access.

### Code rollback

Application rollback is deployment-level and does not require a migration
reversal: every v9/v10 migration is additive (`CREATE OR REPLACE FUNCTION`,
added columns), so an older build runs against the newer schema unchanged.

- Vercel → Deployments → previous known-good → **Promote to Production**.
- Feature-flag rollbacks are faster still and need no deploy:
  `FLAG_MONTHLY_FAIR_USE=0`, `FLAG_PLAN_REPAIR=0`, `FLAG_WEEKLY_REFLECTION=0`.

Do **not** attempt to roll a migration backwards to undo a bad release. Rolling
the deployment back is sufficient and cannot destroy user data.

## E. Evidence to record

Copy into `docs/launch-go-no-go-v11.md` §3 against `P1-ROTATION-RESTORE`.
Anonymize: no emails, no keys, no customer or subscription ids.

**Never write a secret value into this file, even a rotated-out one.** Record
that a secret was rotated and that the old credential was revoked — never the
credential itself, old or new. A revoked key in git history is still a key in
git history.

```
Key rotation drill
  Date:                    ____________
  Operator:                ____________
  Secrets rotated:         ____________
  Old credential revoked:  yes / no
  readiness after:         all ok / failures: ____________
  Rollback needed:         yes / no — if yes, what happened: ____________

Backup restore drill
  Date:                    ____________
  Backup timestamp used:   ____________
  Restore → verified app:  ______ minutes   ← real RTO
  RPC overloads present in restored DB: yes / no
  Scratch project deleted: yes / no
```

An empty field is a blocker. A drill nobody ran is *not* "configured" — it is
unrehearsed, and the go/no-go must say so.
