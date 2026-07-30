# Handoff — closing Mellowa's NO-GO, using what worked on Scalvya

Written in the Scalvya repo for copy-paste into `dailyflowai`. Everything below
is derived from `dailyflowai/docs/launch-go-no-go-v11.md` (frozen at
`0025a50`, baseline `169c706`) and from the Scalvya v11 launch run of
2026-07-28, which took both tracks from NO-GO to GO in one session.

Mellowa is **further along than Scalvya was** in one respect —
`scripts/seed-test-user.mjs` already exists and already seeds ten journey
states — and **behind it** in another: nothing has been charged through live
Stripe, and there is a currency contradiction that is not a documentation
problem.

---

## Do these in order. The order matters.

### 1 · `P0-PRICE-CURRENCY` — fix before anything else · ~20 min

> Live Stripe prices are USD while every surface promises EUR; Stripe does not
> convert.

This one is different from the rest: it is not missing evidence, it is a
**live mismatch between what you promise and what you charge**. Every other
item on the list can be argued about. This one bills a customer an amount that
does not match the page they agreed to.

It also blocks item 2 structurally — there is no point rehearsing a live
transaction against prices you are about to replace.

Worse, Stripe **locks a customer's currency at first charge** and Mellowa reuses
`stripe_customer_id` for the account lifetime. Your own seed script already
knows this (`seed-test-user.mjs`, the `trial-used` branch: *"A customer created
while the prices were USD can never be charged in EUR"*). So every customer
created before the fix is permanently stuck in the old currency.

```
1. Decide the real currency. Not "whatever the prices are" — what the
   product promises on the page.
2. Create new Stripe prices in that currency. Do NOT edit the old ones;
   Stripe prices are immutable and existing subscriptions reference them.
3. Point STRIPE_PRICE_* env vars at the new ids.
4. Run your equivalent of `verify-prices` with the LIVE key. Confirming the
   id is set is not confirming what it charges — that distinction is
   exactly how this got shipped.
5. Write down what happens to customers already on the old currency. It is
   a decision, not an oversight, and it needs to be a recorded one.
```

**Scalvya lesson:** `release-check` confirmed `stripe:price_allowlist — all live
prices set`. That check proves *presence*, not *amount*. Presence checks are
where currency bugs hide.

---

### 2 · `P1-AUTH-E2E-AT-HEAD` — cheapest real win · ~20–30 min

The suite exists and the seeder exists. What stopped it was environment.

**Do not point it at production.** On Scalvya I found the seeding endpoint's
guards all described the *process* (launch mode, an enable flag, a secret) and
none described the *database* — a local run with `SUPABASE_URL` set to
production passed every one of them and would have created real auth users
there. Mellowa's `seed-test-user.mjs` reads `.env.local` directly, so it has
the same exposure with fewer guards.

The fix that worked: a marker table the environment cannot fake.

```sql
-- run against the NON-PRODUCTION project ONLY
create table if not exists public.e2e_seed_marker (
  id boolean primary key default true,
  note text not null,
  created_at timestamptz not null default now(),
  constraint e2e_seed_marker_single check (id)
);
insert into public.e2e_seed_marker (id, note)
values (true, 'This database may be seeded and wiped. It is NOT production.')
on conflict (id) do nothing;
```

Then refuse to seed unless it reads back. Fails closed on a missing table or
any read error. See `backend/routes/e2e-seed.js` in Scalvya for the shape.

Getting a database costs nothing: the Supabase free plan allows **two active
projects per organization**. Apply the migration set, run the marker, point
`.env.local` at it.

**Also fix the skip.** Your own gate says *"`npm run test:e2e` exits 0 even when
every authenticated test skips."* Scalvya's rule: a missing environment makes
the runner **exit non-zero with a BLOCKED message**, never skip. A skip reads as
a decision somebody made. Nobody made it.

---

### 3 · Check the auth callback before you test email · ~5 min

**Look for this in Mellowa before anything else on email.** It cost Scalvya a
production bug that had been live for the entire history of the project.

Every signup consequence was gated on `type === 'signup'` — a query parameter
that only exists on the `token_hash` form of a Supabase confirmation link.
Supabase's **default** template sends `{{ .ConfirmationURL }}` → `?code=…` with
no `type` at all. Result on a real deployment:

- the welcome email — the only marketing email the product had — **had never
  been sent, not once, in the entire history of the database**
- the `verified` analytics event never fired, silently zeroing that row of the
  funnel (a metric reading 0 because nothing reports it is indistinguishable
  from one reading 0 because nobody converted)
- new accounts skipped onboarding entirely

Mellowa is Next.js + Supabase Auth with a confirm-signup template, so check its
callback for the same shape. Grep for `type === 'signup'` or `searchParams.get('type')`.

The fix: derive "this is a first verification" from the **account** (created
recently) rather than from the URL, and rely on the email dedupe key for
idempotency so an ambiguous callback can never double-send.

---

### 4 · `P1-REMINDER-REHEARSAL` — reminders, cron, and consent · ~30 min

Mellowa sends reminders, which makes this heavier than Scalvya's version: a
wellbeing app mailing someone who unsubscribed is worse than a SaaS doing it.

Test **both directions**. Suppressing everything is a failure in the other
direction — withholding a receipt or a security notice from someone entitled to
it.

The sequence that produced clean evidence on Scalvya, using one address you
control (`you+t1@gmail.com`):

```
1. Sign up → confirm → the marketing/welcome mail must arrive with an
   unsubscribe link
2. Click unsubscribe → suppression row written
3. Delete the account, sign up again with the SAME address
   → the marketing mail must be attempted and come back `suppressed`
4. Confirm a transactional message sent AFTER step 2 still arrived
```

Step 3 is the one that matters. Steps 1–2 only prove suppression *records*;
step 3 proves it *blocks*. Read the result from the email ledger, not the inbox
— `suppressed` must be its own terminal state, distinct from `failed`. A message
correctly not sent is not a delivery failure.

Step 4 comes free: account deletion fires a transactional email, so if you do
step 3 by deleting, the evidence is already generated.

For cron specifically, additionally confirm a reminder fires **at the user's
stored timezone**, not the server's. Mellowa already has a `bad-timezone` seed
state; that is the fixture for it.

---

### 5 · `P0-LIVE-TRANSACTION` — after the currency fix · ~30 min

Charge → cancel → reactivate → portal → refund, at the lowest price, refunding
yourself at the end.

**The row that matters most is the one people skip:** a late `payment_failed`
arriving *after* a recovery. Stripe guarantees neither ordering nor
exactly-once delivery, so it happens in normal operation — and if your
out-of-order handling is wrong, a paying customer silently loses access and you
learn about it from a support email. Stripe test clocks can produce it.

Record anonymized evidence only: no card numbers, no customer addresses, no
message bodies. Last 4 characters of ids is enough.

---

### 6 · `P1-ROTATION-RESTORE` — the one to defer honestly

~60 min, and the only item on the list whose absence does not hurt a user on
day one. If you are launching before doing it, **record that as an accepted
risk with your name on it**, not as a closed item. See below.

---

## The mechanism that let Scalvya launch honestly

Mellowa already has the hard part — a machine-readable manifest
(`docs/release/manifest.v11.json`) validated against the prose by
`tests/release-manifest.test.ts`. That is the same architecture as Scalvya's
`docs/launch/launch-state.json` + `launch:verify`. Two additions made the
difference between a gate that blocks forever and one that ships:

**1 · `accepted_risk`.** A red item can be shipped over, but only via a record
carrying a **named person, a date, the tracks it applies to, and a rationale of
real length** — validated, so a placeholder fails the build. Critically it does
**not** rewrite the underlying status: the check still reads `skipped`, the
blocker still reads `accepted` rather than `closed`. The document keeps telling
the truth; what changes is that shipping over it is attributable. A test asserts
that removing the acceptances flips the verdict back to NO-GO on its own.

This is what "launch with known gaps" should look like — not a document quietly
edited until it agrees with the decision.

**2 · Documentation-only drift does not invalidate a candidate.** Recording
evidence writes files, and those writes were marking the candidate stale — so a
fully-evidenced release could never reach GO. The act of writing down a GO
produced a NO-GO. Now only changes to code invalidate it, with the exempt list
narrow (`docs/` and the prompt packs) and a test forbidding `app/`, `src/`,
`e2e/` or `package.json` from ever being added to it. When git cannot answer,
drift still counts as invalidating.

Mellowa's manifest will hit the same wall the moment it gets close to GO.

---

## Two habits worth carrying over

**Don't re-run a flaky test until it passes.** One Scalvya assertion passed
alone and failed in full runs, twice, for two different reasons — `:focus-visible`
depends on input modality, and the unfocused measurement was taken before the
reveal animation settled. A flaky assertion inside release evidence is how a
gate stops meaning anything. Fix the cause, then count the passes explicitly.

**Presence is not correctness.** `release-check` said all live prices were set
while they were in the wrong currency. A check that asks "is it configured?"
cannot answer "is it right?" — and Mellowa's P0 is exactly that gap made real.
