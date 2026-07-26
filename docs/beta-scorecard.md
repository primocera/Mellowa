# Capped beta scorecard — predeclared thresholds

**Purpose:** decide whether a small cohort repeatedly values adapting their day
enough to pay for it. That is the largest remaining uncertainty about Mellowa,
and it is not a technical one — every gate in `launch-go-no-go-v11.md` can go
green while the answer here is still no.

**Predeclared** is the operative word. Every threshold below is written before
the data exists, because a threshold chosen after seeing the number is not a
decision, it is a description. If a number lands under its threshold, the action
in the last column is what happens — not a discussion about whether the
threshold was fair.

Complements `docs/beta-research.md`, which holds the funnel-to-decision map,
interview scripts and the weekly memo template. This file holds the numbers.

---

## Scope and caps

| | Value | Enforced by |
|---|---|---|
| Maximum beta accounts | **50** | Database trigger, migration `039` — not a form check, because signup calls Supabase directly from the browser |
| Eligibility | Adults, general wellbeing interest, no medical or eating-disorder support need | Signup consent + safety classification |
| Support channel | The support address in the legal config, monitored daily | `docs/support-runbook.md` |
| Decision cadence | Weekly, on the same weekday | `docs/beta-research.md` memo template |
| Minimum window before any expansion decision | **4 weeks** | Below |

Closing intake deletes nothing — it blocks new rows only, so a stop is instantly
reversible. Unconfigured, the cap fails **open**, so a missing settings row can
never lock everyone out.

## How every cell is read

Each metric states its numerator, denominator and window explicitly, because
"activation is 40%" is meaningless without them and invites the flattering
reading.

- **Cohort under 5 → `—` (no data).** Not 0%. A zero reads as "this is broken";
  no data means we do not know, and the two lead to opposite decisions. This is
  the same minimum-cell suppression the admin dashboard applies.
- **No data and below-threshold are different states** and are never merged.
- **Window** is a rolling count of completed periods, so a cohort that has not
  yet had the chance to return is not counted as having failed to.

## Thresholds

### 1. Does the sample demonstrate the wedge?

| Metric | Numerator / denominator | Window | Threshold | If below |
|---|---|---|---|---|
| Sample completion | `sample_plan_generated` / `onboarding_completed` | Lifetime | ≥ 70% | Generation or safety failure — investigate before inviting anyone else |
| Sample opened | `sample_plan_opened` / `sample_plan_generated` | 48h | ≥ 60% | Delivery problem, not a feature problem. Fix delivery |
| Sample adaptation used | `sample_value_action_completed` / `sample_plan_opened` | 48h | ≥ 35% | The sample is not showing the wedge. Interview "sample no-return" — do **not** add a feature |

### 2. Does the day-to-day loop actually recur?

This is the section that decides whether Mellowa is a product or a curiosity.

| Metric | Numerator / denominator | Window | Threshold | If below |
|---|---|---|---|---|
| Day-2 return | Accounts with a check-in on day 2 / accounts that completed a sample | 2 days | ≥ 40% | The daily habit is not forming. Interview. **Do not add notifications** |
| Day-3 return | Accounts with a check-in on day 3 / same denominator | 3 days | ≥ 30% | As above; a steep 2→3 drop points at the plan's usefulness, not the reminder |
| Adjust preview opened | `plan_repair_previewed` / accounts with ≥ 2 plans | 4 weeks | ≥ 30% | The day-change moment is not being reached or not being noticed |
| Adjust applied | `plan_repair_completed` / preview opened | 4 weeks | ≥ 50% | Preview is not convincing — the diff is unclear or the result looks worse |
| Undo used at least once | Distinct accounts using Undo / accounts that applied a repair | 4 weeks | **No threshold — observed only** | High Undo is not failure. It may mean people trust it enough to experiment. Read it with interviews, never optimise it down |
| Week opened | `weekly_reflection_completed` / accounts in their second week | 4 weeks | ≥ 25% | The weekly closeout is too heavy |
| Carry-forward used | `next_week_plan_created` / week opened | 4 weeks | ≥ 50% | Continuity is not compelling — the thing Premium is sold on |

### 3. Will they pay, and keep paying?

| Metric | Numerator / denominator | Window | Threshold | If below |
|---|---|---|---|---|
| Trial start | `trial_started` / accounts that completed a sample | 4 weeks | ≥ 15% | Price or paywall clarity. Interview on price and trust before changing price |
| Trial → charge | Subscriptions charged / trials started | Trial length + 2 days | ≥ 40% | The trial is not converting. Read cancellation interviews before discounting |
| Renewal | `subscription_renewed` / subscriptions reaching renewal | First renewal cycle | ≥ 70% | Retention economics do not work yet. Stop widening |
| Refund or dispute rate | Refunds / charges | Lifetime | **≤ 5%, and any dispute is a stop** | A dispute is a trust event; investigate before any further acquisition |

**Sample size caveat that must be stated with any of these:** at 50 accounts,
a trial-conversion denominator is realistically single digits. Report the
denominator every time. A "50% conversion" on four trials is two people, and
must be written as "2 of 4", never as a percentage alone.

### 4. What does it cost to support?

| Metric | Numerator / denominator | Window | Threshold | If below/above |
|---|---|---|---|---|
| Support contacts per active account | Distinct contacts / active accounts | Weekly | ≤ 0.3 | Above: the product is confusing somewhere specific — categorise before building |
| Contacts about billing or access | Billing contacts / total contacts | Weekly | ≤ 20% | Above: an entitlement or disclosure defect, treated as P1 not as support load |
| Safety-related contacts | Any | Weekly | **Any is reviewed individually** | Never a metric to optimise. Each one is read by a human |
| Cost per active account | AI + infrastructure / active accounts | Weekly | Report only — `null` renders as "unknown", never `$0.00` | A zero reads as "free", which is the opposite of no data |

## Interviews — when, and what is asked

Three moments, all consented, all neutral, none triggered by sensitive content:

1. **After the first Adjust.** What changed in your day? Did Mellowa reduce the
   number of decisions, or add some? What did you still do manually?
2. **After the first Week closeout.** Did anything carry into the next week that
   you actually wanted? What would you have carried that it missed?
3. **After a cancellation.** Never blocking or delaying the cancellation itself.
   What stopped being worth it? Was anything unclear, uncomfortable or unsafe?
   Was €9.99 a month justified by what you got?

Questions stay non-clinical and never ask about mood, symptoms or health
outcomes. Cancellation is never delayed, gated or made contingent on answering.

## Freeze rule during the beta

Broad feature additions are frozen for the duration. Act only on:

- a **P0** (safety, allergen, privacy, billing, data loss), or
- a **P1 barrier reported by more than one participant**.

Anything else goes on a list and waits for the evidence to be sufficient. A beta
that keeps adding features never learns whether the thing it already built is
valuable — it only learns that the team is busy.

## Expansion verdict

Widening intake beyond the cap requires **all** of:

- Day-2 return at or above threshold across a full 4-week window;
- Adjust applied at or above threshold;
- No open hard-stop criterion from `docs/beta-research.md`;
- Every P0 and billing/safety P1 in `launch-go-no-go-v11.md` closed;
- Support contacts per account within threshold.

Missing any one of these means **BLOCKED**, and blocked is the default. The
verdict is shown on the admin dashboard so widening cannot happen by momentum —
the way it usually happens is that nobody decides.
