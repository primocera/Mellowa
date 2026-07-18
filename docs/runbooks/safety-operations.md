# Safety-event operations (Launch v6, Prompt 24)

**Owner:** AI safety reviewer (Primoz).

## What safety events are

Every AI generation runs a safety classification *before* generation. When
input trips a boundary (self-harm, harm to others, eating-disorder behaviour,
severe crisis, medical emergency), normal generation stops and a safe support
message is returned. The event is recorded in `safety_events` with a minimized
risk excerpt — never the full journal or check-in content.

## Access

- `safety_events` is service-role only (RLS, no user policies). It is not
  exposed in `/admin/users` — safety triage does not require reading a user's
  full wellbeing content.
- Access is for tuning the safety system's precision/recall, nothing else.

## Retention & review

- **180-day retention.** `RETENTION_RULES` prunes `safety_events` older than
  180 days (crisis-excerpt minimization). Enforced by `/api/cron/retention`.
- **Sampling criteria.** Review a small sample per period: (a) any event that
  led to a completed generation (potential false negative), (b) a random sample
  of blocks (false positives that frustrate real users), (c) any user-reported
  miss. Record findings and any new corpus cases in `src/lib/evals/corpus.ts`.

## Hard prohibitions

- **Mellowa never diagnoses or treats a user.** Reviewers must not infer a
  condition from safety events or write one down as fact.
- **The support inbox is not crisis monitoring.** Mellowa does not provide
  emergency or mental-health support. If a support email contains crisis
  content, reply once with the same region-appropriate resources the app shows
  (`src/lib/safety/crisis-resources.ts`) and do not counsel further. This is
  stated in docs/support-runbook.md and must not drift.

## When the safety system is wrong

- **False negative (unsafe input generated a plan):** treat as SEV1 unsafe
  output — see incident-response.md §3. Kill switch, reproduce, add a failing
  eval case, fix, re-run `npm run eval`.
- **False positive (safe user blocked):** lower severity; capture the phrasing,
  refine the classifier, add a corpus case proving it now passes. Never widen
  the classifier so far that a real risk slips through — precision loss on
  safety is acceptable; recall loss is not.
