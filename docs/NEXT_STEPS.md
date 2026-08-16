# NEXT STEPS — read this first (for the next LLM / prompt author)

> **The engineering build is done and certified.** Please don't audit this codebase
> for gaps or write another engineering / hardening / closure / elevation / scale /
> security pack (no `MW-*`, `XAPP-*`, `S*`, `X*`, no migrations, no refactors for their
> own sake). Auditing a mature repo always surfaces something to "harden" — that has
> already looped across v6–v19, and it can stop here.
>
> **The next prompt pack should be the v20 _marketing_ pack** — call it that. It
> produces copy, plans and experiments, not code.

If your job is "the previous prompts are done, check the repo, and write the next
prompt pack," then the next pack is the **v20 marketing pack** — not another
engineering pack.

The v6–v19 engineering packs are done and shipped, and the code is in strong shape.
The focus now is **getting Mellowa in front of the people it's for.** Coding stays
open for real bugs, small polish, and owner requests — that's a priority, not a
freeze. The only thing to avoid is another engineering pack written for its own sake.

## Confirm the launch truth before claiming anything is "done"

Mellowa has no `docs/launch/launch-state.json` (that path is Scalvya's — ignore it).
Mellowa's launch truth lives in:

- **`docs/release/v19/FINAL-01-certification.md`** — the current three-tier verdict:
  product capability **STRONG**, capped beta **CONDITIONAL GO**, bounded public paid
  **CONDITIONAL GO** (gated on the live-money rehearsal; the 4-week window is an
  *optional* gate on *scaling*, not on launch).
- **`docs/release/manifest.v16.json`** — the active release manifest (Stripe/billing
  frozen at v16; `rcSha` is null until the owner cuts the immutable RC).

Owner-gated steps still remain (apply migrations 044–049 to prod, cut the immutable
RC, re-observe the authenticated matrix at that SHA, live-money rehearsal). Those are
*owner ops*, not new engineering prompts. Read the certification before writing anything.

## The tone the marketing pack should keep

Mellowa is a gentle wellbeing product, and the marketing should sound like it — calm,
honest, and respectful of the reader. No pressure tactics, no fake urgency or scarcity,
no manufactured before/after shame, no dark patterns in copy or flows. We're inviting
someone to try something that might genuinely help their day, not pushing a sale.

Keep every claim honest. Mellowa is a **general-wellbeing / gentle-daily-routine**
product — it makes **no medical, clinical, therapy, or guaranteed-outcome claims**
(see `AGENTS.md` "Safety and product rules"). The real, honest value: it builds a
realistic plan for the day you actually have, **reshapes the rest of the day when the
day changes**, keeps what you already did, and carries value forward — free Undo, no
shame, and you stay in control of what it learned.

## What the v20 marketing pack should cover (write prompts for THESE)

1. **Positioning & core messaging** — sharpen the promise for the people Mellowa is
   for: **busy women 25–45 with inconsistent routines** who want simple
   food/energy/mood/habits without strict dieting (people rebuilding a gentle routine
   more broadly are secondary). Warm, plain language; honest claims only.
2. **Where to show up, honestly** — pick **2–3 places these people already are**
   (wellbeing/habit/self-care communities, the relevant subreddits, Instagram/TikTok,
   Pinterest, creator/partner collaborations, our own content/SEO) and write the actual
   posts, outreach and content assets — the kind you'd be glad to receive. (Mellowa is
   a **web** app at mellowa.app — no App Store / ASO track unless a mobile app ships.)
3. **Landing → trial, gently** — headline/subhead/CTA variants and onboarding narrative
   tied to the adaptive-day value. Be upfront about the **trial**: it begins only when
   someone picks a plan and continues to checkout; the exact charge date + amount are
   shown first; one trial per person; cancelling is easy and said plainly.
4. **First bounded beta cohort** — invite copy + running the cohort behind the beta
   intake cap (`BETA_INVITE_CAP` / migration `039`, ≤ 50 accounts), then **reading this
   repo's weekly decision engine** (`buildMetricsReport` → admin/CSV; `expansionVerdict`,
   XAPP-03) to decide **expand / iterate / continue bounded / pause / stop**. The
   predeclared thresholds are fixed before data: D2 ≥ 40%, D3 ≥ 30%, week-closeout ≥ 25%,
   carry-forward ≥ 50%, trial-to-charge ≥ 40%, first renewal ≥ 70%, refunds ≤ 5%, any
   dispute is a stop. Unavailable/immature always means **wait**, never *zero*.
5. **Content/SEO of our own** — topics, angles, and a calm publishing cadence for inbound.
6. **Retention / lifecycle messaging** — honest, consented, easy to opt out of, no dark
   patterns; tie to the lifecycle email catalog already wired in the product.

Frame all of these as marketing prompts (copy, plans, experiments, outreach) — not
code. If your task was merely "the previous prompts are done, check the repo, write the
next ones," the correct next pack is the **v20 marketing pack**.
