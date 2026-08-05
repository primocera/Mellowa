# Experiment: 3-day vs 7-day trial (MW-V10-02)

**Status:** infrastructure shipped, **not running**. Default production
behaviour is unchanged — every trial is 3 days until the owner enables a cohort.

## The question

Premium is packaged around three jobs: adapt today, reuse what works, and carry
decisions into next week. A 3-day trial can end before a user reaches a single
week closeout, so they decide whether to pay having never used the third job.
Whether a 7-day trial converts better is not a matter of preference — it is
answered by observed return, adjustment, week-closeout and charge rates per arm,
against AI cost.

## Hypothesis

A 7-day trial lets more users reach one real weekly reflection and carry-forward,
and users who reach it convert at a higher rate — enough to offset the extra
trial-period AI cost and the delayed first charge.

## Configuration (owner-controlled, server-side)

Vercel environment variables. All of them are opt-in; with none set the
experiment is inactive and everyone gets the 3-day control.

| Variable | Default | Meaning |
|---|---|---|
| `FLAG_TRIAL_LENGTH_EXPERIMENT` | unset (off) | `1`/`true` enables assignment |
| `TRIAL_EXPERIMENT_VARIANT` | `week_beta` | Arm tested against control. Must be in the app allowlist (`control`, `week_beta`) or the experiment stays inactive |
| `TRIAL_EXPERIMENT_PERCENT` | `0` | Integer 0–100: share of *new* trials assigned to the variant. `0` = inactive |
| `TRIAL_EXPERIMENT_SALT` | `mellowa-trial-length-v10` | Change only to start a genuinely new experiment; changing it re-buckets *future* assignments only |

Suggested ramp: `10` → observe a week → `50`. Do not start at 100: the point is
a comparison.

Only one onboarding experiment may run at a time. `FLAG_EMPHASIZE_YEARLY` also
changes the purchase decision, so **do not** enable it while this experiment is
running.

## Guarantees the implementation makes

- **Server-owned.** The browser never chooses or influences a trial length. The
  checkout route resolves it, pins it, and returns the exact day count and
  charge date; the confirmation card renders that response.
- **Pinned at trial creation.** `subscriptions.trial_days` is written before the
  Stripe session is created. Once set it wins over the flag, the percentage and
  the allowlist — so turning the experiment off, or removing a variant, can
  never shorten or extend a live trial or move a charge date.
- **Stripe is the final truth.** The webhook overwrites `trial_days` with the
  length derived from the real `trial_start`/`trial_end`, so disclosures after
  checkout reflect what Stripe actually granted.
- **Allowlisted metadata.** The variant code travels in Stripe subscription
  metadata and is re-validated against the app allowlist on the
  signature-verified webhook before anything is stored.
- **Cohort data is a variant code and a day count.** No check-in value, plan
  content, journal text or inferred state is attached to an assignment or to any
  experiment event.
- **Commercial terms unchanged.** The catalog prices (USD-first $12.99 / $129.99,
  EU/EEA €11.99 / €119.99 — see `src/lib/stripe/plans.ts`), the refund policy and
  the yearly-emphasis default are untouched by this experiment.

## What is measured

`/admin` → *Trial-length experiment*, and the CSV export, per arm:

| Metric | Why |
|---|---|
| Cohort size | Denominator; also the suppression gate |
| Returned after day 1 | Did the trial produce a second session at all |
| Adjusted a day | Reached the actual wedge (remaining-day repair) |
| Reached a real week closeout | The value a 3-day trial structurally cannot deliver |
| Charged | The decision metric |
| Canceled | Balances "charged" — a charge nobody wanted is not a win |
| AI cost in window | A longer trial costs more before any revenue |

Arms under 5 people report **"not enough data"**, never `0%`. A suppressed arm
is not a result and must not be read as one.

## Stop rules

Turn the experiment off — set `FLAG_TRIAL_LENGTH_EXPERIMENT=0` — immediately if
any of these is true. Rollback is a flag change with no data migration: pinned
trials continue and complete exactly as disclosed.

1. **Any unexpected-charge report.** One user charged on a date they were not
   shown is a stop, not a data point. Refund, then investigate.
2. **Disclosure mismatch.** Any surface (landing, pricing, paywall, checkout
   return, billing, email) showing a trial length or charge date that disagrees
   with the user's pinned value.
3. **Complaint or dispute rate rises in either arm** relative to the pre-
   experiment baseline, in absolute terms — not net of the other arm.
4. **AI cost per trialing user in the variant exceeds ~2× control** without a
   conversion-rate difference outside suppression.
5. **No retention lift after both arms clear 50 completed trials.** If the
   variant does not show a higher rate of *reaching a week closeout* and of
   *being charged*, the longer trial is only costing money — stop and keep the
   3-day control.
6. **Both arms stay suppressed for four weeks.** Volume is too low for this
   experiment to answer anything; stop and revisit after acquisition grows.

Whatever the outcome, record it in `docs/launch-go-no-go-v10.md` §2 with the
per-arm numbers as of the stop date, so the trial length becomes a decision on
record rather than a default nobody revisited.

## Owner-run steps (never automated from code)

Claude Code does not mutate live Stripe or Vercel. To run this:

1. Confirm the live Stripe prices are unchanged (this experiment does not touch
   price objects — the trial length is set per checkout session).
2. Set the env vars above in Vercel (Production) and redeploy.
3. Verify on a real signup that pricing, the confirmation card, the billing page
   and the trial-started email all state the same length and charge date.
4. Record the ramp date and percentage here.
