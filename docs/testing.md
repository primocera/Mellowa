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

`e2e/journeys.spec.ts` needs a **test** Supabase project (never production)
and a pre-seeded confirmed user:

```sh
$env:E2E_SUPABASE_TEST="1"
$env:E2E_TEST_EMAIL="e2e@example.com"
$env:E2E_TEST_PASSWORD="..."
npm run test:e2e
```

Tests skip themselves when unconfigured, so CI stays green without secrets.

### Stripe billing cycle (manual runbook until a dedicated test env exists)

1. `stripe listen --forward-to localhost:3000/api/stripe/webhook`
2. Sign up → verify email → Pricing → Start trial (card `4242 4242 4242 4242`).
3. Verify: entitlement unlocks, trial banner shows, exact charge date shown
   before checkout, second checkout blocked (`already_subscribed`).
4. `stripe trigger invoice.payment_failed` → status past_due, generation gated.
5. Cancel at period end → distinct "ends on <date>" UI + reactivate works.
6. Delete account → Stripe subscription canceled, export empty afterwards.

## CI

`.github/workflows/ci.yml`: npm ci → lint → typecheck → Vitest → production
build → Playwright public suite (chromium, 1 worker) on pinned Node 22.
Placeholder env only — no live Supabase/Stripe/Anthropic calls, keeping runs
reliable on free plans.
