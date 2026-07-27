# Handoff to Scalvya — shared Stripe account, and defects worth re-checking

**Written:** 2026-07-27, from the Mellowa side, during the v11 launch rehearsal.
**Audience:** whoever next works on the Scalvya repo.

Two parts. **Part 1 is a live bug in Scalvya** with evidence attached, found
because it emailed the owner about a Mellowa subscription. **Part 2 is a list of
defects found in Mellowa the same night** — Scalvya shares an author, a stack and
several patterns, so each one is worth ten minutes of checking there. Part 2 is
*suspicion, not diagnosis*: nobody has looked at Scalvya's code.

---

## Part 1 — Scalvya is processing other products' Stripe events

### What happened

The owner started a trial on **Mellowa** and received a **"your trial is
ending" email from Scalvya**, for an account he does not have with Scalvya.

### Why

One Stripe account (`acct_1TQcF60YzvSNMCpN`) serves Mellowa, Scalvya, Frost and
several other products. Three webhook endpoints are registered on it:

```
https://mellowa.app/api/stripe/webhook                6 events
https://scalvya.com/api/webhooks/stripe               8 events
https://frost.primoz2-cerar.workers.dev/api/stripe-webhook   1 event
```

**A Stripe webhook endpoint subscribes to event *types*, not to products,
customers or prices.** Stripe broadcasts every matching event to every enabled
endpoint on the account. It has no concept of an event "belonging" to Scalvya.

So Scalvya's endpoint receives every Mellowa and Frost subscription event, and
apparently creates records and sends lifecycle mail from them. Separate URLs
separate nothing; the filtering has to happen inside the handler.

### What Scalvya must do

**Ignore events that are not Scalvya's.** Pick whichever discriminator Scalvya's
checkout already sets — the same options Mellowa had:

1. **Subscription metadata.** If Scalvya's checkout stamps something like
   `metadata.scalvya_user_id` on `subscription_data`, then absence of it means
   the subscription is not Scalvya's.
2. **The price id.** If the subscription's price is not one of Scalvya's
   configured prices, it is not Scalvya's.
3. **The customer id.** If no local row maps that `stripe_customer_id` to a
   Scalvya user, it is not Scalvya's.

Metadata is the most reliable, because a customer can exist before any local row
does. Use (3) only in combination, never alone.

**Acknowledge and ignore — do not throw.** This is the part that bit Mellowa
harder than the emails bit Scalvya. Mellowa's handler raised a retryable error
on any subscription it could not map, so every Scalvya and Frost event became a
permanently failing delivery on Mellowa's endpoint. **Stripe disables endpoints
that keep failing.** A disabled webhook means paying users silently never get
access — the worst failure a billing integration has, reached without anyone
touching the billing code.

If Scalvya throws or 500s on foreign events today, it is accumulating the same
risk right now.

**Keep the retry for the real race.** There is a legitimate case where an event
arrives before the local row is written. Distinguish it: *metadata present but
no row* is a race and should retry; *no metadata at all* is another product's
event and should be acknowledged and dropped.

### How Mellowa fixed it

`src/app/api/stripe/webhook/route.ts`, commit `4dedd76`. `syncSubscription`
returns `{ ignored: true }` when there is no `supabase_user_id` in metadata and
no matching stored customer; all four call sites stop on that result, so
analytics and lifecycle code cannot act on a foreign customer either. Regression
test in `tests/webhook-isolation.test.ts`.

### The real fix, for later

**One Stripe account per product.** Shared accounts also share Radar rules,
disputes, payout schedules, branding on Stripe-sent emails, and account-level
restrictions — a problem with any one product can suspend charging for all of
them. Untangling this after either product has real customers is materially
harder than doing it now, because customers, subscriptions and payment methods
cannot be moved between accounts without re-collecting card details.

Also worth knowing: **Stripe's own automated customer emails** (trial ending,
receipts, failed payment) are configured per *account* and carry account-level
branding. Even with perfect webhook filtering, those may reach Mellowa users
with the wrong product's name on them. Check Settings → Customer emails.

---

## Part 2 — Defects found in Mellowa the same night, worth checking in Scalvya

None of these has been checked in Scalvya. Each was live in Mellowa, none was
caught by a 1000-test suite, and each took under an hour to find once someone
looked at the right thing.

### 1. Stripe prices in the wrong currency

Mellowa's live prices were **USD** while every surface — landing, paywall,
Terms, Refund policy, emails — promised **EUR**. Stripe does not convert: a user
reading "€9.99" was charged $9.99, their bank converted at its own rate and
added a foreign-transaction fee.

It also **broke checkout entirely**. An EU card being asked to authorise a USD
charge from an EU merchant was declined after 3DS with
`setup_intent_authentication_failure` / `generic_decline`, which reads exactly
like a card problem and is not one. Hours were lost blaming the bank.

**Check:** fetch each configured price from Stripe and compare currency and
amount against what the app displays. Mellowa now does this in
`scripts/verify-stripe-prices.mjs` (`npm run verify-prices`) — read-only, exits
non-zero on mismatch. Worth copying.

**Why nothing caught it:** the release check verified the price IDs were *set*,
never what they cost. Verifying presence is not verifying correctness — that
distinction is the theme of this whole document.

### 2. Idempotency key that does not include the price

Mellowa's checkout used `checkout_{userId}_{interval}_{trial|paid}`. Stripe
caches an idempotency key for 24 hours and **rejects reuse with different
parameters**:

```
StripeIdempotencyError: Keys for idempotent requests can only be used with the
same parameters they were first used with.
```

So the moment the price changed, every user who had attempted checkout in the
previous 24 hours got a hard failure on every retry. It looks like an outage,
resists all retries, and heals itself the next day before anyone can debug it.

**Check:** does Scalvya's checkout use an idempotency key? Does it include the
price? Any pricing change, currency change or price experiment triggers this.

### 3. `toLocaleDateString(undefined, …)` in a client component

Resolves to the runtime's locale — Node's on the server, the visitor's in the
browser. Different strings, so server and client HTML disagree and React throws
hydration error #418. In Mellowa this was on the paywall line reading *"Cancel
before {date} to avoid the €9.99 charge"* — the one date a paying user must be
able to trust, briefly rendering as a different date than the server intended.

**Check:** grep for `toLocaleDateString()` and `toLocaleDateString(undefined`.
Any hit inside a component that also renders server-side is this bug. Pin the
locale explicitly, or format server-side and pass the string down.

### 4. Tests that had stopped testing

Three separate instances in Mellowa, all invisible because a skipped test looks
like a deliberate decision:

- A locator matched copy that had been renamed, so `test.skip(notFound, …)`
  fired and the test skipped for every user, forever, reporting nothing.
- **Playwright never loaded `.env.local`.** Next.js loads it and the seed script
  had its own loader, but the test runner had neither — so configuring the E2E
  suite in the obvious place configured nothing, and it skipped while looking
  correct. This is a large part of why those suites went months without running.
- Two required journeys were **unreachable by any fixture**: every seed state
  wrote a subscription row, so a trial-eligible user and a prior-trial user
  could not be produced.

**Check:** in any suite that skips conditionally, ask what makes a skip visible.
If the answer is "nothing", the suite is decorative. Mellowa's guard is
`tests/e2e-integrity.test.ts` — it runs in the *unit* suite deliberately, so it
holds precisely when the browser environment is absent and the browser tests
cannot defend themselves.

### 5. No way to sign out on mobile

Mellowa's only sign-out was in a `hidden md:flex` desktop sidebar. On a phone
there was no way to end a session at all — not in the nav, not in settings. For
an app holding personal data on a shared or lost device that is a privacy
defect, not a missing convenience. The owner found it by opening the app; a
1076-test suite and an 8-state authenticated journey matrix did not, because
every test asserted what a signed-in user can *do* and none asserted they can
*stop*.

**Check:** can you sign out of Scalvya on a phone?

### 6. Webfonts loaded and never rendered

`layout.tsx` loaded two Google fonts and exposed them as CSS variables, but no
component used `font-sans` and `globals.css` set `body { font-family: Arial }`,
which won. 53KB downloaded on every page load, on the critical path, painting
nothing. Removing them cut the landing page 22% with **no visual change**.

**Check:** does anything actually apply the font you are loading? Does a `body`
rule override it?

---

## The pattern worth carrying over

Every defect above shares a shape: **something verified that a thing existed,
and nothing verified that it was right.**

- The price IDs were set — nobody checked the currency.
- The tests existed — nobody checked they ran.
- The fonts loaded — nobody checked they rendered.
- The sign-out existed — nobody checked it was reachable.
- The webhook was registered — nobody checked whose events it got.

When adding a check to Scalvya, ask what it would take for that check to pass
while the product is broken. If the answer is easy, the check is decoration.

## Practical notes for the Scalvya session

- **Two Stripe accounts exist.** `acct_1TQcF60YzvSNMCpN` is live/production.
  `acct_1TsoY60ekENjtIka` is a separate, largely unused account whose **test**
  key sits in Mellowa's `.env.local`. Diagnosing the wrong one cost an hour
  here — always print the account id before drawing conclusions from its state.
- Stripe's dashboard has no top-level SetupIntents page; failed card setups show
  on the **customer's timeline**, or via the API.
- Querying the Stripe API read-only (`accounts.retrieve`, `prices.retrieve`,
  `setupIntents.list`) answered in minutes what the dashboard hid for hours.
  Reach for the API first.
