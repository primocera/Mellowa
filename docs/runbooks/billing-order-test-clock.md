# Steps 5–6 — failure→recovery + late-failure ordering (test-clock)

Owner-run, **test mode only**. Closes the deferred half of `P0-LIVE-TRANSACTION`
(steps 5–6 of `live-transaction-rehearsal.md`) without real money. Test mode is a
separate Stripe universe — **nothing here touches live keys, live prices, the
live webhook or live data.** The webhook handler and the ordering guard
(`src/lib/stripe/event-order.ts`) are identical in test and live, so proving the
ordering here proves the production code path. No live re-test is needed after.

The one thing that makes this scriptable: the app only creates a `subscriptions`
row when the subscription carries `supabase_user_id` metadata (everything else is
treated as a foreign product and ignored). So we set that metadata explicitly and
drive the whole thing from the CLI on a test clock.

## Prerequisites

- Stripe CLI logged in to the **test** account: `stripe login`.
- A test-mode monthly price id (`price_…`) — create one if needed:
  `stripe prices create --unit-amount 999 --currency eur --recurring interval=month -d "product_data[name]=Mellowa Monthly (test)"`
- The app running locally against a **non-production** Supabase, with **test**
  Stripe env:
  ```
  STRIPE_SECRET_KEY=sk_test_...
  STRIPE_PRICE_PRO_MONTHLY=price_...        # the test price above
  STRIPE_WEBHOOK_SECRET=<from `stripe listen`, next step>
  ```
- Webhook forwarding to the local route, left running in its own terminal:
  ```
  stripe listen --forward-to localhost:3000/api/stripe/webhook
  ```
  Copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET` and restart the app.
- A real test user in the local Supabase. Sign up through the app, then grab the
  auth uuid (Supabase → Authentication → Users). Call it `UID`.

Set shell vars for the rest:
```bash
UID=<the-supabase-auth-uuid>
PRICE=$STRIPE_PRICE_PRO_MONTHLY
```

## Step 5 — failure → recovery

```bash
# 1. Test clock, frozen at now.
TC=$(stripe test_helpers test_clocks create --frozen-time $(date +%s) \
      --name mellowa-5-6 -d 2>/dev/null | grep -oE 'tc_[A-Za-z0-9]+' | head -1)
echo "clock=$TC"

# 2. Customer on that clock.
CUS=$(stripe customers create --test-clock $TC --email clocktest@example.com \
      | grep -oE 'cus_[A-Za-z0-9]+' | head -1)
echo "customer=$CUS"

# 3. A payment method that FAILS the charge, attached to the customer.
stripe payment_methods attach pm_card_chargeCustomerFail --customer $CUS

# 4. Create the subscription WITH the supabase_user_id metadata so the app
#    creates a real row. The first invoice charges the failing card.
stripe subscriptions create --customer $CUS \
  --items "price=$PRICE" \
  --default-payment-method pm_card_chargeCustomerFail \
  -d "metadata[supabase_user_id]=$UID" \
  -d "payment_behavior=error_if_incomplete" 2>&1 | tail -3
```

**Expected after step 5.1:** `stripe listen` shows `customer.subscription.created`
then `invoice.payment_failed`, each `[200]`. In the DB the row exists and is
`past_due`, and `last_stripe_event_created` = the failure event's `created`.

```sql
select status, last_stripe_event_created
from subscriptions where stripe_customer_id = 'cus_...';   -- past_due
```

Now recover: swap to a good card and pay the open invoice.

```bash
stripe payment_methods attach pm_card_visa --customer $CUS
stripe customers update $CUS -d "invoice_settings[default_payment_method]=pm_card_visa"
# Pay the latest open invoice for this customer:
INV=$(stripe invoices list --customer $CUS --status open \
      | grep -oE 'in_[A-Za-z0-9]+' | head -1)
stripe invoices pay $INV
```

**Expected after recovery:** `stripe listen` shows `invoice.payment_succeeded`
`[200]`; the row is back to `active`; `last_stripe_event_created` has moved
**forward** to the success event's `created` (this is the watermark that step 6
relies on). One failure email and one recovery email — no duplicates.

```sql
select status, last_stripe_event_created
from subscriptions where stripe_customer_id = 'cus_...';   -- active, higher ts
```

Record the failure event id — you need it for step 6:
```bash
FAIL_EVT=$(stripe events list --type invoice.payment_failed \
           | grep -oE 'evt_[A-Za-z0-9]+' | head -1)
echo "failure event=$FAIL_EVT"
```

## Step 6 — late failure after recovery (the v12 guard, the whole point)

Redeliver the **old** `payment_failed` now that a **newer** success is the
watermark. The guard must drop it.

```bash
stripe events resend $FAIL_EVT
```

**Expected — this is the pass/fail line:**
- `stripe listen` shows the redelivered `invoice.payment_failed` returning
  `[200]` (acked, not errored).
- The row **stays `active`** — it is NOT dragged back to `past_due`.
- `last_stripe_event_created` is **unchanged** (still the success watermark).
- **No** second failure email is sent (`deliverEmail` is never reached because
  the guard returns before the update block).

```sql
select status, last_stripe_event_created
from subscriptions where stripe_customer_id = 'cus_...';   -- STILL active, ts unchanged
```

If the row flips to `past_due` or the timestamp goes backward, that's a **FAIL** —
stop and tell me; it means the guard regressed since `tests/billing-lifecycle-order.test.ts`.

## Cleanup

Deleting the test clock removes the customer, subscription and invoices attached
to it in one shot:
```bash
stripe test_helpers test_clocks delete $TC
```
Then delete the local test user through the in-app deletion flow, and stop
`stripe listen`. Nothing in live was touched.

## Record

Report back: the three DB reads (past_due → active → still-active) and that the
redelivered failure returned `[200]` with no second email. I'll record
**"steps 5–6: test-clock verified <date>"** against `P0-LIVE-TRANSACTION` in the
manifest — a permanent evidence line, no live re-test ever required.
