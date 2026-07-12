# DailyFlow AI — Safety & Privacy Review (Prompt 32)

Datum: 2026-07-12 · Stanje: pred beta testiranjem

## Passed checks ✅

| # | Check | Status | Dokaz |
|---|-------|--------|-------|
| 1 | Vsi AI generation routi zaščiteni z auth | ✅ | vseh 6 routov v `src/app/api/ai/*` kliče `supabase.auth.getUser()` in vrne 401 brez userja; grep audit čist |
| 2 | Safety check pred generacijo | ✅ | `checkInputSafety` teče pred vsako generacijo v: daily-plan, weekly-plan, meal-rhythm, journal-reflection, regenerate-section. Izjema: habit-plan — ne sprejema nobenega prostega teksta (bere samo profil/check-ine iz DB), zato nima česa klasificirat |
| 3 | Unsafe inputi blokirani | ✅ | `should_block_generation → { blocked: true, user_message }`, plan se NE generira; classifier failure → fail-closed (blokira) |
| 4 | Občutljivi inputi se ne logirajo v celoti | ✅ | `safety_events.user_input_excerpt` max 120 znakov; AI error logi vsebujejo samo metadata (model, dolžina, issue paths), nikoli user teksta |
| 5 | RLS na vseh user-owned tabelah | ✅ | migracija 001: RLS + select/insert/update/delete "own" policy na vseh 12 tabelah; + auto-RLS event trigger v Supabase |
| 6 | Service role samo server-side | ✅ | `lib/supabase/admin.ts` in `lib/env.ts` imata `import "server-only"` (build faila ob client importu); admin uporabljen samo v stripe routih + safety logging |
| 7 | Medical/therapy/ED meje v product copy | ✅ | safety note v onboardingu (korak 6, obvezen checkbox), landing sekcija 7 + FAQ + footer, journal "not therapy" copy, settings disclaimer |
| 8 | Public strani brez weight-loss/medical claims | ✅ | landing eksplicitno: "never counts calories… no weight loss promises"; pricing brez zdravstvenih trditev |
| 9 | Safety note v onboardingu | ✅ | korak 6 — `safety_acknowledged` se shrani šele po checkboxu (Zod `z.literal(true)`) |
| 10 | Errorji jasni in ne-strašljivi | ✅ | topli fallbacki ("Couldn't create the plan right now — try again in a moment"), safety sporočila brez klinike, 402 z jasnim upgrade pojasnilom |

## Issues found & fixed med reviewom

- **Quality gate dodan** (Prompt 31): `lib/ai/quality-checks.ts` — banned language scan (kalorije, weight-loss, fasting, medical, therapy, shame), limit gostote plana, obvezen habit + encouragement; ob failu 1× safer regeneracija, sicer 502.
- `internal_reason` iz safety classifierja se ne vrača klientu (samo server log).

## Remaining limitations (znano, sprejeto za beta)

1. **Safety classifier je LLM** — možni so false negativi na zelo posrednem jeziku. Mitigacija: fail-closed + banned-language quality gate + ročni test cases (`docs/safety-test-cases.md`).
2. **Excerpt v safety_events** (≤120 znakov) je vseeno občutljiv podatek — tabela je RLS-private, ampak dostopna adminu projekta. Za produkcijo razmisli o krajši retenciji.
3. **Rate limiting** ni implementiran (samo mesečni plan limiti). Za beta OK, za javni launch dodaj npr. Upstash rate limit na AI route.
4. **Email confirmation** je za beta izklopljen — pred javnim launchom vklopi + custom SMTP.
5. Weekly/meal/journal outputi gredo skozi safety check inputa, ne skozi post-generation quality gate (ta pokriva samo daily plan). Širitev po potrebi.
