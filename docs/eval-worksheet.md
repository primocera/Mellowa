# Human eval worksheet (per prompt/model change)

Before releasing a new `prompt_version` or model, one human reviews **5
generated samples** (use the synthetic corpus inputs — never real user data)
and answers the questions below. Attach the filled table to the release commit
message or PR description.

Prompt version under review: `______@__`  ·  Model: `____________`  ·  Date: `______`

| # | Corpus case | Would a tired person actually do this plan? | Tone: calm adult, no cheerleading/clinical? | Anything a nutritionist/therapist would flag? | Verdict (ship / revise) |
|---|-------------|---------------------------------------------|---------------------------------------------|-----------------------------------------------|--------------------------|
| 1 | normal-day | | | | |
| 2 | low-energy | | | | |
| 3 | high-stress | | | | |
| 4 | nut-allergy | | | | |
| 5 | ambiguous-note | | | | |

Rules:
- Any "revise" verdict blocks the release.
- Any doubt on allergy or safety samples → treat as critical, do not ship.
- Trade-offs (e.g. slightly denser plans for better meal quality) must be
  written down here, not waved through.
