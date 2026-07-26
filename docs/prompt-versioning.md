# Prompt versioning + launch eval suite (Launch v6, Prompt 12)

## Immutable prompt versions

`src/prompts/versions.ts` registers every system prompt with an immutable id
(`daily-plan-v2@1`, `weekly-plan@1`, …) and a **sha256 content hash**.
`tests/prompt-versions.test.ts` recomputes the hash on every test run:

- Edit a prompt without bumping → the test fails and prints the new hash.
- To ship a change: bump `id` to a new version (`@2`), record the new hash.
- Never reuse or edit an old id.

The active version id is written into `ai_usage_events.prompt_version` when a
generation is finalized (daily-plan and weekly-plan routes), so every ledger
row, cost figure and quality outcome is attributable to an exact prompt.

**Rollback:** `git revert` the prompt change; the hash test proves you are on
the exact previous text, and new ledger rows carry the previous version id.

## Evaluation suite

- **Corpus** — `src/lib/evals/corpus.ts`: fully synthetic, de-identified cases
  covering normal, low-energy, high-stress, no-cook, budget, vegetarian,
  allergy, ambiguity, prompt injection and all safety categories (self-harm,
  eating disorder, harm to others, medical request). Only synthetic fixtures
  are in git.
- **Validators** — `src/lib/evals/validators.ts`: deterministic scoring for
  input safety (pre-classifier must block crisis inputs), schema validity,
  allergen safety, forbidden terms, tone/density/diet-culture (via the shared
  quality gate) and actionability. `critical` issues have **zero tolerance**;
  `minor` issues feed the human worksheet.
- **Gate** — `tests/eval-suite.test.ts` runs in `npm test` (and therefore
  `npm run release-check`). It includes a deliberately unsafe candidate output
  that must fail, proving the gate works, and a stability check (two runs,
  identical results). Per project rule there is **no CI**; this local gate is
  the release blocker.

## Comparing current vs candidate prompts (manual procedure)

1. Create the candidate as a **new** version (`daily-plan-v2@2`) — never edit
   the old one in place while comparing.
2. Run `npm run eval` before and after switching. Zero critical regressions
   (safety, allergen, schema) is mandatory; minor trade-offs need an explicit
   note in the commit message.
3. For live-model behavior (latency, cost, tone nuance), generate against the
   corpus inputs with `AI_MOCK` off in a local run and compare the ledger rows
   (`prompt_version`, `latency_ms`, `actual_cost_usd`, `status`). Fixed
   settings: same model, temperature and max tokens for both sides.
4. Fill in `docs/eval-worksheet.md` before release — all seven dimensions, all
   seven cases, including the 4-day sequence (the only place repetition can be
   judged). Any score of 1, or a mean under 3.0 on any single dimension, blocks
   the release. A version with no attached worksheet has not been evaluated,
   whatever the test count says.
5. Optionally run `scripts/eval-live.mjs` (MW-V10-04) for real-generation
   evidence. It is opt-in, cost-capped, records the model id and UTC date, and
   is **advisory**: it exits 0 always and cannot gate a release. No LLM is ever
   used to judge safety — it drives `/api/ai/daily-plan`, so the deterministic
   safety, allergen and fair-use gates all still apply.
6. Record the plan-level provenance you expect to see: `daily_plans` now stores
   `prompt_version`, `model_version` and `is_fallback` (migration `037`), so a
   specific plan can be traced back to the version that produced it. A spike in
   `is_fallback` for a new prompt version is a regression signal.

## Safety categories

Crisis inputs are asserted against the deterministic pre-classifier
(`src/lib/safety/pre-classify.ts`) — the strongest guarantee, since it works
even when the provider is down. Subtle cases (e.g. disease-specific meal
requests) intentionally defer to the AI classifier; the output validators still
ban medical/diet language regardless.
