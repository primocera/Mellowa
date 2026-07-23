# Live transaction rehearsal — owner-run checklist (MW-V9-00)

**Owner:** Primoz. **This checklist is executed by a human against the live
project.** Claude Code never runs any of these steps — it cannot move real
money or mutate live Stripe/Supabase/Vercel/Resend. Record anonymized evidence
in the row provided and copy the result into `docs/launch-go-no-go-v9.md`.

**Why this exists:** the v8 go/no-go keeps public paid launch at **NO-GO**
because one real charge → cancel → reactivate → portal → refund path has never
been recorded. This is the single open **P0**. Configured/deployed Stripe keys
prove configuration, not that a charge works.

**Pre-conditions**
- Live Stripe in live mode: secret key, webhook endpoint (`/api/stripe/webhook`,
  subscribed events) with its signing secret, live EUR prices
  `STRIPE_PRICE_PRO_MONTHLY` (€9.99), `STRIPE_PRICE_PRO_YEARLY` (€59.99).
- Migrations `001`–latest applied to the live project (`/api/health/ready` → ok).
- A disposable real payment method you control; be ready to refund immediately.

---

## Steps (record evidence for each — do not leave blank before selecting GO)

| # | Step | Expected | Evidence |
|---|---|---|---|
| 1 | Verified signup + email confirm | account active, no console errors | __ |
| 2 | Onboarding baseline saved | wellbeing profile persisted | __ |
| 3 | Free sample plan generated | one lifetime sample; no card requested | __ |
| 4 | One sample adjustment | bounded, server-claimed once; second attempt refused | __ |
| 5 | Eligible trial checkout (live) | exact charge disclosure shown before confirm | __ |
| 6 | Trial → first charge | €9.99 (or €59.99) actually captured in Stripe | __ |
| 7 | Webhook entitlement | subscription row active; app grants Premium | __ |
| 8 | Daily repair on a live plan | one transaction, no partial plan; Undo restores exactly | __ |
| 9 | Cancel (`/api/stripe/cancel` or portal) | cancel_at_period_end; read access retained | __ |
| 10 | Reactivate | subscription active again; no double charge | __ |
| 11 | Billing portal | opens, shows correct plan/next date | __ |
| 12 | Refund via Stripe + support path | refund processed; entitlement adjusts on webhook | __ |
| 13 | `/api/cron/billing-reconcile` | returns `ok:true` after the above | __ |
| 14 | Email outbox | trial/charge/cancel emails delivered; retry + dead-letter visible; pause/skip suppresses | __ |
| 15 | AI cost/latency + daily ceiling | observed live including the repair route | __ |

## Idempotency / safety spot-checks
- [ ] Replay one webhook event → **no** duplicate charge, generation or entitlement change.
- [ ] Double-tap repair / retry after timeout → no double repair, no double bill.
- [ ] Blocked/crisis input during trial → no generation, no entitlement consumed, no upsell.
- [ ] Export then delete the test account → zero rows remain in every user-owned
      table in `src/lib/privacy/registry.ts` (verify the v8 tables:
      `daily_plan_versions`, `learned_signal_suppressions`, `routine_presets`,
      `weekly_reflections`, plus any v9 additions).

## Result
- Date run: ____  ·  Operator: ____
- Outcome: PASS / FAIL (attach anonymized evidence IDs, not customer data)
- If PASS: copy evidence into `docs/launch-go-no-go-v9.md` §live evidence and
  only then may the paid verdict move off NO-GO.
