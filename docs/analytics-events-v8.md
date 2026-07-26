# Analytics event contract — v8 (MW-S10)

Source of truth for validation is `src/lib/analytics/taxonomy.ts` (fixed
`EVENT_NAMES`, `.strict()` property schema, server/client partition). This
document adds the human contract per event: trigger, owner, allowed and
prohibited properties, and the product question it answers.

**Global rules (all events)**

- Allowed properties: only the enumerated keys in `propertiesSchema`
  (`source, campaign, surface, plan_interval, route, outcome, model_version,
  prompt_version, experiment, churn_type, cancel_reason, item_type, plan_mode,
  defer_reason, repair_reason, sections, signal, context_type`). Values are
  enums or bounded slugs.
- Prohibited always: raw check-in scales (mood/energy/stress/sleep values),
  notes, journal text, allergies, meal/plan content, custom preset names,
  emails, free text of any kind. The strict schema rejects unknown keys and
  prose values.
- Retention purpose: product analytics; `app_events` rows are pruned after
  365 days (`RETENTION_RULES`) and **anonymized** on account deletion
  (registry `onDelete: anonymize`). Export covers a user's events.
- Server-authoritative events are rejected from `/api/events`; only the
  server writer can record them (dedupe: value completions are written once
  per confirmed action — completion upsert, RPC commit, Stripe webhook).
  Analytics failure never blocks the user action (`trackEvent` is
  fire-and-forget; the client beacon is best-effort).

## v8 value-loop events

| Event | Trigger | Owner | Allowed props | Product question |
|---|---|---|---|---|
| now_viewed | Today rendered with the Now card | client | plan_mode | Is the Now view seen? |
| now_action_done | plan_completions row saved with source=now | server | item_type, plan_mode | Do users complete one next step? |
| now_action_deferred | "Not now" reason chosen | client | item_type, plan_mode, defer_reason | Why doesn't the step fit? |
| plan_repair_requested | repair POST accepted | server | repair_reason | Is repair wanted? |
| plan_repair_completed | apply_plan_repair committed | server | repair_reason, sections, outcome | Does repair succeed? |
| plan_repair_failed | provider/gate/save failure | server | repair_reason, outcome | Where does repair break? |
| plan_repair_undone | undo RPC restored a version | server | — | Is repair trusted? |
| personalization_viewed | "What Mellowa uses" opened | client | surface | Is memory transparency used? |
| preference_changed | preferences saved | client | surface | Do users steer plans? |
| learned_signal_removed | suppression row written | server | signal | Which signals feel wrong? |
| preset_created | preset row inserted | server | context_type | Are presets adopted? |
| preset_applied | preset prefill applied | client | surface, context_type | Do presets cut friction? |
| preset_removed | preset row deleted | server | — | Do presets stay useful? |
| favourite_reused | weekly generation used favourites | server | surface | Does meal reuse happen? |
| shopping_draft_built | shopping_lists row saved | server | surface | Is the shopping loop used? |
| weekly_reflection_started | closeout opened | client | surface | Is the closeout attempted? |
| weekly_reflection_completed | reflection row upserted | server | — | Is the closeout finished? |
| carry_forward_saved | non-empty selections saved | server | — | Do choices carry forward? |
| next_week_plan_created | weekly plan row saved | server | outcome | Does continuity convert to a new week? |
| sample_value_action_completed | sample's curated swap saved | server | surface | Does the sample prove adaptation? |
| premium_value_explained | entitlement explanation shown | client | surface | Is the paid story seen in context? |
| reminder_enabled | opt-in saved after preview | client | surface | Are reminders wanted? |
| reminder_paused | pause toggled on | client | surface | Are reminders too much? |
| reminder_disabled | opt-out saved | client | surface | Do reminders churn? |
| reminder_link_opened | arrival with from=reminder | client | surface | Do reminders bring people back? |
| premium_value_viewed | billing plan card rendered | client | surface | Is the offer seen? |
| reactivation_started | cancel flag cleared via API | server | surface | Do canceled users return? |
| primary_nav_viewed | a primary destination opened (MW-V9-01) | client | surface, entitlement | Which of Today/Week/Saved/You do users use? |
| checkin_started | daily check-in opened (MW-V9-02) | client | surface | Do people who open the check-in finish it? |
| payment_refunded | Stripe `charge.refunded` (MW-V10-00) | server | surface, outcome | Did the owner-run refund rehearsal actually settle? |
| payment_disputed | Stripe `charge.dispute.created` (MW-V10-00) | server | surface, outcome | Are disputes appearing — a trust signal needing an owner, never an automated access change? |

Legacy (v6) events, unchanged: landing_cta_clicked, signup_started,
signup_completed, email_verified, onboarding_started, onboarding_completed,
sample_plan_requested, sample_plan_generated, sample_plan_opened,
paywall_viewed, checkout_started, checkout_completed, trial_started,
trial_canceled, cancellation_requested, trial_converted,
subscription_renewed, payment_failed, payment_recovered, plan_feedback,
account_deleted, checkin_completed, plan_generated, plan_fallback_served.

## Metrics

Primary value metrics: sample value action completion, successful repair
rate, next-day return, weekly return, paid retention. Secondary/diagnostic
only: generation counts and completion counts — never optimized directly,
never interpreted as wellbeing improvement. Small-cohort results are
directional and must be paired with consented interviews.

## Beta experiments (4 weeks, ≤50 invites)

Each experiment has one primary metric, guardrails, a decision rule and a
rollback switch. Rolling back turns the surface off (env flag, no deploy) and
corrupts no data.

| Experiment | Primary metric | Guardrails | Decision rule | Rollback |
|---|---|---|---|---|
| Now default on Today | now_action_done / now_viewed | complaints, safety events, no drop in plan_generated | keep if ≥30% of viewers complete one action in wk 3–4 | UI revert (single component) |
| Repair preview | plan_repair_completed / requested; undo rate | repair failure rate, AI cost/day, allergen gate hits | keep if completion ≥70% and undo <30% | `FLAG_PLAN_REPAIR=0` |
| Memory transparency | learned_signal_removed + preference_changed engagement | none sensitive; removal must take effect next generation | keep if viewed without complaint; removal bugs = stop | UI revert |
| Weekly closeout | weekly_reflection_completed → next_week_plan_created | no pressure complaints, no invented-insight report | keep if ≥25% weekly return among actives | `FLAG_WEEKLY_REFLECTION=0` |

**Stop criteria (pause invites / roll back immediately):** unsafe AI output
or allergen exclusion miss reaching a user; any duplicate charge or duplicate
generation; privacy leak of any kind (including sensitive data in analytics
or email); sustained high repair failure rate; email complaint spike or
dead-letter growth; no next-day or weekly reuse signal after 4 weeks (stop
widening, run interviews instead).
