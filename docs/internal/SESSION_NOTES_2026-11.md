# Session notes — legal pass and product ideas (Oct–Nov 2026)

Read this first in the next session to know where we are. Release verdicts still live
in the generated status page (see `RELEASE_NOTES_FOR_AGENTS.md`), not here.

## 1. Legal pass — shipped in `32f70a4` (branch `legal-fixes`)

The owners asked for a check that Mellowa is legally sound (no fines). Findings and
what was changed:

| Gap | Fix in `32f70a4` |
|---|---|
| Wellbeing inputs (mood, energy, stress, sleep, allergies, journal) are GDPR Art. 9 health data, but there was no explicit consent | Separate unticked checkbox on signup and on the consent checkpoint. `/api/consent` and the auth callback require `health_data: true`. Recorded with the `privacy` consent row (no migration, because `user_consents.consent_type` has a CHECK constraint). Terms/privacy versions bumped to `2026-10`, so every existing user re-confirms once before their next AI generation |
| Pre-signup analytics id (`mellowa_anon_id`) stored in localStorage without consent (ePrivacy / ZEKom-2) | The id now lives in memory only, for the current visit. Any id stored earlier is deleted on first use. It was removed from the browser-storage registry |
| Privacy policy missing the controller, legal bases, full rights and the complaint authority | Rewritten: controller, legal basis per purpose, health data, cookies/on-device storage, full rights, complaint to the Information Commissioner (ip-rs.si), 18+ |
| Terms missing an AI-accuracy note, an allergy disclaimer, termination and governing law; the "as is" clause is invalid for EU consumers | Added all of these; liability rewritten so consumers' statutory rights are not excluded |
| EU 14-day withdrawal right not explained (risk: the window extends to 12 months) | Refund page: 14-day withdrawal = full refund, plus the model withdrawal form. Pricing page links the Terms and the withdrawal right before checkout |
| US consumer health data laws (Washington MHMDA, Nevada) | New `/health-data` page, linked from the homepage footer (MHMDA requires that link) |

Already fine before this pass: 18+ age gate (stricter than COPPA's 13), not-medical
disclaimers, crisis/medical pre-classifier, auto-renew disclosure, trial-ending email,
online cancel, data export/delete, email unsubscribe, no ad trackers.

No Stripe, checkout, webhook, entitlement or quota code was changed.

### Owner to-dos (not code)

- [ ] Vercel: `LEGAL_ENTITY_NAME` = the real people responsible for the data (not the
      brand "Mellowa"); `LEGAL_REGISTERED_ADDRESS` = the full address with postcode, city
      and country.
- [ ] Vercel: make sure `NEXT_PUBLIC_PRIVACY_VERSION` / `NEXT_PUBLIC_TERMS_VERSION` are
      unset or `2026-10`, otherwise existing users are not asked for the new consent.
- [ ] DPAs accepted with Anthropic, Supabase, Vercel, Stripe and Resend (GDPR Art. 28).
- [ ] GDPR Art. 30 record of processing (needed because we process health data) —
      can be drafted on request.
- [ ] A one-page breach plan (notify the Information Commissioner within 72 h).
- [ ] Someone watches the support inbox: 14-day withdrawals are refunded by hand in
      Stripe.
- [ ] A lawyer review before scaling marketing (this pass is not legal advice).

### Open (code, needs an owner OK — touches billing, frozen at v16)

- California automatic-renewal law: a reminder 15–45 days before a yearly plan renews.
  Only the trial-ending email exists today. Confirm the rule applies before building it.

## 2. Release

`legal-fixes` (`32f70a4` + this notes commit) is pushed to `main`, which deploys
mellowa.app. That moves production off the last certified SHA, so a new
release-candidate run → freeze → promote is needed at the pushed SHA. The owner
triggers the workflow in GitHub Actions (`gh` is not installed locally).

GraphQL work on the `graphql-practice` branch was practice only and is NOT part of
the release.

## 3. Product ideas discussed (not built — decisions so far)

Status vs the original blueprint (July 2026): all of build weeks 1–6 are shipped, plus
more (reshape-the-rest-of-the-day, free Undo, make today lighter, visible preference
learning, Library). What is weakest is the blueprint's §14 beta validation: there are
too few users to read the metrics. **The next work is marketing and users, not features**
(see `docs/NEXT_STEPS.md`).

| Idea | Decision |
|---|---|
| Camera: photo of a meal → calories | **No.** It contradicts the blueprint ("no calorie tracker"), `BANNED_PATTERNS` and the "No calorie targets" positioning; it is an eating-disorder risk for the audience, and photo estimates are inaccurate. Alternative worth testing: **photo of the fridge/pantry → meal ideas from what you have** (fits "less deciding", leftovers and the shopping list; the AI provider supports images) |
| Camera: film an exercise → "is my form right?" | **No.** Injury liability if the app says the form is correct, technically hard, and Mellowa offers gentle movement moments, not training. Alternative: the trainer co-founder records short demo videos for each movement moment |
| Custom meal/exercise plan made by the co-founders (nutrition + training), for people the app blocks (for example diabetes) or who want more personalisation; the request is sent by email and the plan is imported into the app | **Validate demand first, build later.** Medical nutrition (diabetes and other conditions) may only be done by a registered dietitian or doctor, so check qualifications or keep custom plans general and keep referring conditions out. Eating disorders and pregnancy are always referred out. It would need separate terms for the human service, professional liability insurance, a privacy-policy update and separate consent (a person sees health data) |

### Demand test for custom plans (no code)

1. Count blocked requests in production: `safety_events` rows with
   `risk_type = 'medical_nutrition'` (needs owner OK to read prod).
2. Instagram story poll / DM keyword showing the real offer and price, not "interested?".
3. Do the first 5–10 by hand (email + PDF), as blueprint §14.1 suggests. Build the
   import-into-app feature only after about 5 paid requests in a month.

## 4. Pointers

- Banned-language lists: `src/lib/ai/quality-checks.ts` (`BANNED_PATTERNS`, AI output),
  `src/lib/safety/pre-classify.ts` (requests blocked before generation),
  `src/lib/content/terminology.ts` (customer copy), `src/lib/progress/neutral.ts`
  (Progress copy).
- Marketing rule of thumb: no health promises ("reduces stress", "boosts energy",
  weight loss) — EU health-claims rules and the FTC; paid or gifted influencer posts must
  be labelled as ads.
