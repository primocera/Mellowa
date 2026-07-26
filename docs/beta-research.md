# Beta research & retention decisions (MW-V9-11)

Four-week, ≤50-invite beta. Goal: decide whether Mellowa becomes a **repeat
adaptive habit**, using privacy-safe behaviour + consented interviews + explicit
stop criteria. Small cohorts are directional only — never statistical proof and
never evidence of health improvement. Language is **use / return / completion**,
never adherence, improvement or recovery.

## Beta value-loop funnel → product decision

Single canonical funnel: `FUNNELS.value_loop` (taxonomy). Every value step is a
server-confirmed event; the admin dashboard shows distinct-subject numerator and
step conversion (denominator = prior step), with cohorts < 5 suppressed as “—”
(the no/insufficient-data state).

| Step (event) | Reads as | If weak, decision |
|---|---|---|
| signup_completed | account created | acquisition/landing message — iterate copy (MW-V9-08) |
| onboarding_completed | baseline set | onboarding friction — shorten first run |
| sample_plan_generated | first value produced | generation/safety failure — investigate before widening |
| sample_plan_opened | value seen | sample delivery/notification — fix delivery, not features |
| sample_value_action_completed | sample proved adaptation | the sample doesn't demonstrate the wedge — interview "sample no-return" |
| trial_started | intent to pay | price/paywall clarity — interview on price & trust |
| checkin_completed | next-day return | the daily habit isn't forming — interview, do NOT add notifications |
| now_action_done | one next step done | Now isn't useful/visible — Now-default experiment |
| plan_repair_completed | adapt-the-day value | repair not trusted/needed — repair-preview experiment + Undo/failure interview |
| weekly_reflection_completed | weekly loop closed | closeout too heavy — weekly-closeout experiment |
| next_week_plan_created | continuity converts | carry-forward not compelling — interview "weekly no-return" |
| subscription_renewed | rational repeat pay | retention economics — see unit-economics scorecard |

## Experiments — one at a time or non-overlapping cohorts

Run the four v8 experiments (Now default, repair preview, memory transparency,
weekly closeout) per `docs/analytics-events-v8.md`. Each has one primary metric,
guardrails, a keep rule and a **tested flag rollback** (`FLAG_PLAN_REPAIR`,
`FLAG_WEEKLY_REFLECTION`, `FLAG_MONTHLY_FAIR_USE`, UI reverts). Rolling back turns
a surface off with no data loss and no migration reversal.

## Consented interview scripts (optional, neutral, never triggered by sensitive content)

Invitations are opt-in and never triggered by a safety/vulnerability
classification. Never quote a participant publicly without separate explicit
consent. Ask about **decision load, fit, trust and price** — never diagnoses,
symptoms or emotional vulnerability.

1. **Sample, no return** — What did the sample day get right/wrong? Did it feel
   made for a day like yours? What would have made you open Mellowa the next day?
   Would this price feel fair for that?
2. **Now defer / ignore** — When you saw the one next step, what made it easy or
   easy to skip? Was it the right thing at the right time? What would you rather
   have seen first?
3. **Repair Undo / failure** — You adjusted the rest of a day (or it didn't work).
   Did you trust what changed and what stayed? Was Undo clear? What would make you
   rely on it?
4. **Weekly, no return** — Did closing out the week feel worth the minute? Did
   carrying choices forward match what you wanted next week? What would bring you
   back on a Sunday/Monday?
5. **Cancellation** — What stopped being worth it? Was it price, fit, effort or
   trust? What would have kept you — and what should we not have done?

## Weekly decision memo (template)

Fill once per week. The decision is exactly one of five, and **Continue is a
choice you have to make, not the default that happens when nobody decides**:

| Outcome | Means | Typical trigger |
|---|---|---|
| **Continue** | Keep the current build and the current experiment running | Every loop step at or above hypothesis, no stop criterion open |
| **Iterate** | Change one thing, in one area, and re-measure | One step below hypothesis with a clear product cause |
| **Pause** | Keep the product running, stop the experiment | Two experiments in one area, or a result that is not attributable |
| **Roll back** | Turn a surface off via its flag | The experiment made a guardrail worse (complaints, cost, undo rate) |
| **Stop** | Close intake (`beta_settings.signups_open = false`) | Any hard stop criterion below is open |

Vanity generation counts are not a decision input.

**The dashboard answers the expansion question for you.** `/admin` shows an
explicit *Expansion: OK / BLOCKED* verdict with its reason, derived from
next-day return over the current window (MW-V10-06,
`src/lib/analytics/loop-decisions.ts`). Two states are kept strictly apart
there and must be kept apart here: **no data** (cohort under 5 — nothing to
read) and **below hypothesis** (there is data, and it is worse than we hoped).
Never report the first as if it were the second, and never report either as
proof of anything at this cohort size.

**Four-week rule, enforced in code:** no meaningful next-day return after four
weeks **blocks expansion**. The verdict returns `canExpand: false` with that
reason until both the window and the return hypothesis are met, so widening
intake cannot happen by momentum.

**Cancellation stays neutral.** It is never blocked, delayed or made
conditional on answering anything; the exit interview is optional and asked
after the cancellation has already gone through.

```
Week N (dates)
- Behaviour: value-loop funnel numerators + step rates (dashboard, window=7)
- Retention: D1/D7 next-day & weekly return; renewals
- Unit economics: p50/p90 gens, high-use count, cost/active, contribution/payer
- Safety & trust: safety events, allergen gate hits, complaints, repair undo rate
- Reliability: fallback rate, webhook/reconcile mismatches, outbox dead letters, cron
- Qualitative: interviews run + themes (decision load / fit / trust / price)
- Decision: continue | iterate | pause | rollback | stop acquisition
- Rationale (2–3 lines):
```

## Hard stop criteria (widen nothing while any is open)

Unchanged from `docs/analytics-events-v8.md`: unsafe or allergen-miss output
reaching a user; any duplicate charge or duplicate generation; a repair
corruption; any privacy leak (incl. sensitive data in analytics or email);
reminder complaint spike or dead-letter growth; or
**no meaningful next-day or weekly reuse after four weeks** — in which case stop
widening and run interviews rather than adding notifications or features.
