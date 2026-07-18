# Testing

## Unit tests (hermetic)

```sh
npm run test          # Vitest — no external services
```

## E2E (Playwright, single worker — free-tier friendly)

```sh
npm run build && npm run test:e2e:public   # public surface, no services needed
```

Runs at 375px mobile + desktop. Screenshots/traces retained on failure in
`test-results/`.

### Authenticated journeys

`e2e/journeys.spec.ts` logs in as a **synthetic, clearly-labelled test user**
and walks the authenticated surfaces (dashboard, consent checkpoint, settings
data controls, trial-aware pricing). It skips itself unless
`E2E_SUPABASE_TEST=1`, so the default run stays green without secrets.

No separate Supabase project is required. The free tier caps you at two
projects, so the test user lives in the **same live project** — this is safe
because RLS scopes every row to its owner, so the synthetic user can only ever
see its own data. Keep the account obviously non-real (`test@mellowa.local`)
and delete its rows periodically (or via the in-app delete-account flow).

1. Seed / reset the user (idempotent — resets the password each run):

   ```sh
   npm run seed:test-user
   ```

   It creates a confirmed user with a wellbeing profile and an active trial
   subscription, using `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` from
   `.env.local` (defaults `test@mellowa.local` / `Mellowa123!`).

2. Run the authenticated suite:

   ```sh
   $env:E2E_SUPABASE_TEST="1"
   $env:E2E_TEST_EMAIL="test@mellowa.local"
   $env:E2E_TEST_PASSWORD="Mellowa123!"
   npm run test:e2e
   ```

If you later provision a dedicated test project, point `.env.local` at it and
the same commands work unchanged — nothing here hard-codes production.

### Stripe billing cycle (manual runbook until a dedicated test env exists)

1. `stripe listen --forward-to localhost:3000/api/stripe/webhook`
2. Sign up → verify email → Pricing → Start trial (card `4242 4242 4242 4242`).
3. Verify: entitlement unlocks, trial banner shows, exact charge date shown
   before checkout, second checkout blocked (`already_subscribed`).
4. `stripe trigger invoice.payment_failed` → status past_due, generation gated.
5. Cancel at period end → distinct "ends on <date>" UI + reactivate works.
6. Delete account → Stripe subscription canceled, export empty afterwards.

## No CI — run checks locally before pushing

This project deliberately runs **no GitHub Actions / CI** (avoids failure-email
spam and keeps everything on free tiers). Before pushing, run the gate locally:

```sh
npm run lint          # optional — eslint is very slow locally
npm run typecheck
npm run test
npm run build
npm run test:e2e:public
```

`npm run release-check` bundles the pre-launch gate. Vercel's build on deploy is
the backstop for `next build`.
