# NEXT STEPS — read this first (for the next LLM / prompt author)

> **The engineering build is DONE and certified. Do NOT audit this codebase for gaps,
> and do NOT write another engineering / hardening / closure / elevation / scale /
> security prompt pack** (no `MW-*`, `XAPP-*`, `S*`, `X*`, no migrations, no refactors
> for their own sake). Auditing a mature repo always turns up something to "harden" —
> that is an infinite loop, and it has already repeated across v6–v19. **It stops here.**
>
> **The next prompt pack MUST be MARKETING / DISTRIBUTION / GTM** — it outputs copy,
> plans and experiments, **never code.**

**If your job is "the previous prompts are done, check the repo, and write the next
prompt pack" — then write a MARKETING / GTM pack (call it the v20 *marketing* pack).
NOT another engineering pack.**

The v6–v19 engineering packs are done and shipped. The code is in strong shape. The
**PRIMARY focus now is DISTRIBUTION / MARKETING.** Coding stays open for real bugs,
small polish, and explicit owner requests — that is a priority, not a freeze. Just
don't churn out another engineering pack by default.

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

## What the marketing pack should cover (write prompts for THESE)

Keep every claim honest. Mellowa is a **general-wellbeing / gentle-daily-routine**
product — it makes **NO medical, clinical, therapy, or guaranteed-outcome claims**
(see `AGENTS.md` "Safety and product rules"). The real, honest value: it builds a
realistic plan for the day you actually have, **reshapes the rest of the day when the
day changes**, keeps what you already did, and carries value forward — free Undo, no
shame, you stay in control of what it learned.

1. **Positioning & core messaging** — sharpen the promise for the ICP: **busy women
   25–45 with inconsistent routines** who want simple food/energy/mood/habits without
   strict dieting (solo founders/small-brand self-improvers secondary). Honest claims only.
2. **Channel plan & outreach** — pick **2–3 channels** where these buyers actually are
   (wellbeing/habit/self-care communities, the relevant subreddits, Instagram/TikTok,
   Pinterest, creator/influencer partnerships, our own content/SEO). Write the actual
   outreach and content assets. (Mellowa is a **web** app at mellowa.app — no App
   Store / ASO track unless a mobile app ships.)
3. **Landing → trial conversion** — headline/subhead/CTA variants, the **trial
   framing** (trial begins only when the user picks a plan and continues to checkout;
   exact charge date + amount shown first; one trial per person), objection handling,
   and the onboarding narrative tied to the adaptive-day value.
4. **First bounded beta cohort** — invite copy + running the cohort behind the beta
   intake cap (`BETA_INVITE_CAP` / migration `039`, ≤ 50 accounts), then **reading this
   repo's weekly decision engine** (`buildMetricsReport` → admin/CSV; `expansionVerdict`,
   XAPP-03) to decide **expand / iterate / continue bounded / pause / stop**. The
   predeclared thresholds are fixed before data: D2 ≥ 40%, D3 ≥ 30%, week-closeout ≥ 25%,
   carry-forward ≥ 50%, trial-to-charge ≥ 40%, first renewal ≥ 70%, refunds ≤ 5%, any
   dispute is a stop. Unavailable/immature always means **wait**, never *zero*.
5. **Content/SEO of our own** — topics, angles, and a publishing cadence for inbound.
6. **Retention / lifecycle messaging** — honest, consented, no dark patterns; tie to
   the lifecycle email catalog already wired in the product.

Frame all of these as GTM/marketing prompts (copy, plans, experiments, outreach) —
**not code.** If your task was merely "the previous prompts are done, check the repo,
write the next ones," the correct next pack is a **MARKETING** pack.
