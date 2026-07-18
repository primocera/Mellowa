# Product analytics contract (Launch & Scale v6, Prompt 9)

Privacy-safe, versioned event taxonomy for measuring acquisition, activation,
retention and billing. The contract lives in `src/lib/analytics/taxonomy.ts`
(pure, testable) and is enforced by `tests/analytics-contract.test.ts`. Events
are written server-side by `trackEvent` (`src/lib/analytics.ts`) and, for
views/clicks only, via `POST /api/events`.

## Principles

- **Fixed, versioned names.** `ANALYTICS_VERSION` + the `EVENT_NAMES` enum.
  Never rename an event; add a new name and bump the version. Each row stores
  `event_version`.
- **Enumerated properties only.** `propertiesSchema` is `.strict()`, so unknown
  keys are rejected. This is the primary guarantee that mood values, allergies,
  journal or plan contents can never be stored — those keys don't exist. Values
  are enums or bounded non-free-text slugs, so prose can't ride in on an allowed
  key either.
- **Server-authoritative truth.** Identity, billing and generation outcomes are
  emitted only from trusted server paths. `POST /api/events` rejects any event
  in `SERVER_AUTHORITATIVE_EVENTS` (403) — a browser can claim a view or click,
  never a payment or a verified signup.
- **No cross-site tracking.** Attribution uses a first-party anonymous id
  (`anon_id`) generated in the app. On verified signup it is merged onto the
  user via `merge_anonymous_events` and cleared, so pre-signup steps join the
  same funnel without any third-party identifier.

## Allowed properties

`source`, `campaign`, `surface`, `plan_interval`, `route`, `outcome`,
`model_version`, `prompt_version`, `experiment`. Never: free text, mood,
allergies, journal or plan contents.

## Canonical funnels (`FUNNELS`)

Each funnel is an ordered list of events. Reconstruct one with a single grouped
query over `app_events` counting `distinct user_id` per step (no double-count,
since a step never repeats within a funnel):

| Funnel | Steps |
|--------|-------|
| acquisition | landing_cta_clicked → signup_started → signup_completed → email_verified |
| activation | email_verified → onboarding_started → onboarding_completed → sample_plan_requested → sample_plan_generated → sample_plan_opened |
| monetization | paywall_viewed → checkout_started → checkout_completed → trial_started → trial_converted |
| billing_health | subscription_renewed, payment_failed, payment_recovered, trial_canceled, account_deleted |

Example (acquisition funnel, last 30 days):

```sql
select event, count(distinct coalesce(user_id::text, anon_id)) as reached
from public.app_events
where event in ('landing_cta_clicked','signup_started','signup_completed','email_verified')
  and created_at > now() - interval '30 days'
group by event;
```

## Where events fire (server-authoritative)

| Event | Source |
|-------|--------|
| checkin_completed, plan_generated, plan_fallback_served | `api/ai/daily-plan` |
| checkout_completed, trial_started, trial_converted, trial_canceled | `api/stripe/webhook` |
| payment_failed, payment_recovered, subscription_renewed | `api/stripe/webhook` |
| account_deleted | `api/account/delete` |

Client view/click events (e.g. `landing_cta_clicked`, `paywall_viewed`) post to
`/api/events` and are validated against the same contract before storage.

## Privacy, retention & legal basis

- **Legal basis:** legitimate interest in operating and improving the service,
  limited to non-content, first-party product events. No sensitive category
  data is collected (guaranteed structurally by the strict schema).
- **Retention:** `app_events` rows are pruned after **365 days**
  (`RETENTION_RULES` in `src/lib/privacy/registry.ts`).
- **Deletion / anonymization:** on account deletion, `app_events.user_id` is set
  null (`onDelete: "anonymize"` in the registry) — the aggregate counts survive
  but the personal link is severed. `anon_id` rows carry no personal data.
- **Opt-out:** because only non-content, first-party operational events are
  stored and they anonymize on deletion, there is no separate tracking profile
  to opt out of; deleting the account removes the personal link entirely.

## Adding an event or property

1. Add the name to `EVENT_NAMES` (and to `SERVER_AUTHORITATIVE_EVENTS` if it
   asserts identity/billing/generation truth). Bump `ANALYTICS_VERSION` if the
   change is not purely additive.
2. Add any new property to `propertiesSchema` with an enum or slug constraint.
3. Extend `FUNNELS` / this dictionary if it belongs to a funnel.
4. `tests/analytics-contract.test.ts` must stay green.
