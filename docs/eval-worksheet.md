# Human eval worksheet (per prompt / model / schema change)

The deterministic gate (`npm run eval`) proves a plan is **safe, in-schema, on
tone, in time budget and non-repetitive**. It cannot judge whether the plan is
*good*. That is what this worksheet is for, and a human must fill it in before
any `prompt_version`, model or output-schema change ships.

**Never use real user data.** Every input comes from the synthetic corpus in
`src/lib/evals/corpus.ts`.

## Header (fill in first — a review without these is not reproducible)

| Field | Value |
|---|---|
| Prompt version under review | `______@__` |
| Prompt version being replaced | `______@__` |
| Model id | `____________________` |
| Date (UTC) | `__________` |
| Reviewer | `__________` |
| Deterministic gate result | `npm run eval` → pass / fail |
| Live eval run? | no / yes (`scripts/eval-live.mjs`, cost `$____`) |

## Scoring

Every dimension is scored **1–5** against the anchors below. The anchors exist
so two reviewers on different days land within one point of each other — a score
without its anchor is an opinion, not evidence.

**1 = would make me stop using the app · 3 = acceptable · 5 = clearly better
than the version being replaced.**

| # | Dimension | 1 | 3 | 5 |
|---|---|---|---|---|
| 1 | **Usefulness** — did this help decide what to do today? | Generic advice I could have written myself | One or two items genuinely help | Every item earns its place |
| 2 | **Specificity** — is it concrete? | "Eat healthy", "move your body" | Named foods and actions, some vagueness | Named, ordered, immediately actionable |
| 3 | **Feasibility** — could a tired person do it in the time stated? | Times are fiction | Mostly realistic | Realistic including the smaller versions |
| 4 | **Non-repetition** — across the 4-day sequence | Same day repeated | Some overlap, varied enough | Varied without becoming random |
| 5 | **Tone** — calm adult, no cheerleading or clinical language | Coaching or clinical | Neutral, occasionally flat | Warm, adult, unhurried |
| 6 | **Meal continuity** — do leftovers and favourites make sense together? | Contradictory or wasteful | Reasonable | Deliberate — a day's cooking is reused |
| 7 | **Edit / repair need** — how much would you change before using it? | Rewrite most of it | One or two swaps | Use as-is |

### Required cases

Run the same seven dimensions over each. Cases 1–6 are single days; case 7 is
the **4-day sequence** from `consecutiveDaysFixture`, and is the only place
dimension 4 can be judged at all.

| # | Corpus case | 1 Useful | 2 Specific | 3 Feasible | 4 Non-rep. | 5 Tone | 6 Continuity | 7 Edit need | Comment (required if any score ≤ 2) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `normal-day` | | | | n/a | | | | |
| 2 | `low-energy` | | | | n/a | | | | |
| 3 | `high-stress` | | | | n/a | | | | |
| 4 | `little-time` | | | | n/a | | | | |
| 5 | `vegetarian-nut-allergy` | | | | n/a | | | | |
| 6 | `sparse-input` | | | | n/a | | | | |
| 7 | 4-day sequence | | | | | | | | |

## Decision rules

- **Any score of 1 blocks the release.** No averaging around it.
- **Any allergen or safety doubt is critical**, regardless of scores — stop, and
  fix the deterministic gate, not the prompt.
- **A mean below 3.0 on any single dimension blocks the release.** A strong
  overall mean does not buy a weak dimension.
- **Improve one dimension at a time.** If two dimensions regress while one
  improves, that is not an improvement — record it and revert.
- Trade-offs must be **written in the comment column**, not waved through.
  "We accepted denser plans for better meal continuity" is a valid decision only
  if it is written down here.

## Recording the result

Attach the filled table to the release commit or PR, and record the outcome in
`docs/prompt-versioning.md` next to the version id. A version with no worksheet
attached has not been evaluated, whatever the test count says.

---

## Optional live provider eval

`scripts/eval-live.mjs` runs the corpus against the real provider. It is **off
by default** and can never gate a release on its own:

```sh
EVAL_LIVE=1 EVAL_LIVE_MAX_USD=0.50 node scripts/eval-live.mjs
```

- Requires an explicit `EVAL_LIVE=1` **and** `AI_PROVIDER_API_KEY`. Without
  both it prints `SKIPPED` and exits 0 — a missing key is never a pass.
- Stops as soon as estimated spend reaches `EVAL_LIVE_MAX_USD` (default
  `$0.50`) and reports how many cases it did **not** run.
- Records the model id and UTC date, so a result can be tied to a specific
  model version.
- Its findings are **advisory input to this worksheet**. The deterministic gate
  is the release gate: a live-eval failure is a reason to investigate, and a
  live-eval pass is never a reason to skip anything above.
- **No LLM is ever the judge of safety.** Every assertion the live script makes
  runs through the same deterministic validators as `npm run eval`.
