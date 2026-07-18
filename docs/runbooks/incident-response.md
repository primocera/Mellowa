# Incident response (Launch v6, Prompt 24)

Mellowa is run by a solo operator (Primoz). "Roles" below are hats one person
wears; the value is a defined order of operations and named external
escalation, not headcount. Each critical scenario has an **Owner**, an
**Escalation path**, a **Customer message** template and a **Recovery check**.

## Roles

| Role | Holder | External escalation |
|---|---|---|
| Incident commander (security) | Primoz | Supabase support; hosting (Vercel) support |
| Privacy request owner | Primoz | Data-protection counsel (retained on need) |
| Billing owner | Primoz | Stripe support / disputes |
| AI safety reviewer | Primoz | AI provider trust & safety |
| Customer communications | Primoz | — |

## Severity levels

- **SEV1** — active data exposure, auth compromise, unsafe AI output reaching a
  user, or duplicate/erroneous billing. Drop everything; consider kill switch
  (`AI_KILL_SWITCH`) and/or maintenance. Target ack < 1h.
- **SEV2** — degraded but contained: provider outage with working fallback,
  billing drift, email mis-send to a bounded set. Target ack < 4h.
- **SEV3** — cosmetic or single-user issue with a workaround. Next business day.

## Runbooks

### 1. Data exposure (SEV1)
- **Owner:** Incident commander.
- **Escalation path:** Supabase support → data-protection counsel if personal
  data left the system.
- **Immediate steps:** revoke/rotate `SUPABASE_SERVICE_ROLE_KEY` and any
  implicated key; check RLS with `supabase/checks/rls-audit.sql`; scope which
  rows/users; preserve `admin_audit_log`.
- **Customer message:** "We identified an issue that may have exposed limited
  account data on [date]. Here's what happened, what was affected, and the
  steps we've taken. [details]. We're sorry."
- **Recovery check:** rls-audit returns zero unexpected rows; rotated keys
  confirmed in Vercel; GDPR breach-notification clock assessed (72h).

### 2. Auth abuse (SEV1/2)
- **Owner:** Incident commander.
- **Escalation path:** Supabase auth support.
- **Immediate steps:** identify pattern (credential stuffing, enumeration);
  confirm rate limits; force-reset affected sessions; disable generation for
  abusive accounts via `/admin/users` (audited).
- **Customer message:** "We noticed unusual sign-in activity and secured your
  account. Please reset your password. Your plan data is unaffected."
- **Recovery check:** abusive sessions revoked; no further anomalous
  `app_events`; affected users notified.

### 3. Unsafe AI output (SEV1)
- **Owner:** AI safety reviewer.
- **Escalation path:** AI provider trust & safety.
- **Immediate steps:** set `AI_KILL_SWITCH` for the affected route/prompt;
  capture the output + `ai_usage_events.prompt_version`; confirm the pre-gen
  safety classifier and output guards; add a corpus case in
  `src/lib/evals/corpus.ts` reproducing it.
- **Customer message:** "Thank you for flagging this. That response fell short
  of what Mellowa should ever say. We've paused that feature while we fix it."
- **Recovery check:** new eval case fails before / passes after the fix; kill
  switch lifted only once `npm run eval` is green.

### 4. Allergen incident (SEV1)
- **Owner:** AI safety reviewer.
- **Escalation path:** counsel if harm occurred.
- **Immediate steps:** reproduce with the user's allergy set; verify
  `findAllergenViolations` / severe-allergy block; if the guard missed a term,
  extend `allergens.ts` and add a corpus case; kill the meal routes if
  systemic.
- **Customer message:** "We take allergens extremely seriously. A meal
  suggestion didn't correctly exclude [category]. Please don't rely on it; here
  is what we've corrected."
- **Recovery check:** allergen eval cases pass; severe-allergy path still
  refuses meal specifics.

### 5. Provider outage (SEV2)
- **Owner:** Incident commander.
- **Escalation path:** AI provider status page / support.
- **Immediate steps:** confirm circuit breaker + curated fallback are serving;
  watch `plan_fallback_served`; no customer-facing panic — fallback is a
  designed state.
- **Customer message:** "Plans are being served from our saved library while
  our AI provider recovers. Everything still works; personalization resumes
  shortly."
- **Recovery check:** breaker closed; live generation resumed; fallback rate
  back to baseline.

### 6. Billing drift (SEV2)
- **Owner:** Billing owner.
- **Escalation path:** Stripe support.
- **Immediate steps:** run `/api/cron/billing-reconcile`; review exceptions
  (unknown price, duplicate customer, stuck webhook); flag affected users for
  billing review in `/admin/users`. See docs/billing-ops.md.
- **Customer message:** "We spotted a mismatch in your subscription and have
  corrected it. Your access and next charge date are now accurate: [details]."
- **Recovery check:** reconcile returns `ok: true`; no drift on re-run.

### 7. Email mis-send (SEV2)
- **Owner:** Customer communications.
- **Escalation path:** email provider (Resend) support.
- **Immediate steps:** identify template + recipient set from
  `email_deliveries`; stop the source (fix data or disable the trigger);
  assess if any sensitive content leaked (should be impossible — see
  categories.ts and the no-sensitive-content email test).
- **Customer message:** "You may have received an email from us in error.
  Please disregard it. No action is needed and your data is unaffected."
- **Recovery check:** offending trigger fixed; no sensitive field present in
  any sent payload; dead-letter queue clear.

## Post-incident review

Within 3 business days, write a blameless review: timeline, customer impact,
root cause, preventive controls, action owners + deadlines. Store alongside the
tabletop log.
