# v11 run log

One short entry per prompt. Working branch `v11`, cut from `main` at
`169c706683a821054351f45a5916f667ea93557c`. No per-prompt commits by design —
everything is committed together at the end of MW-V11-08, after review.

Status vocabulary matches `src/lib/release/manifest.ts`: *not run*, *blocked*,
*skipped*, *failed*, *local pass*, *CI pass*, *preview pass*, *live rehearsed*,
*observed*. An unrun check is never written down as green.

---

## MW-V11-00 — Reconcile current-main truth and rebuild the release baseline

**Outcome:** done. One canonical machine-readable manifest now owns release
truth, a validator enforces the ways a release record goes wrong, and the three
self-contradictions in the v10 document set are repaired.

**Drift check.** HEAD was exactly the reviewed baseline `169c706` — no drift.
Against the frozen v10 RC `e817aa4` there are 9 commits, but only **one touches
product code**: `src/app/page.tsx`, the landing header reverted to its v9
layout. Everything else is docs, e2e specs, the seed script, `.env.example` and
the playwright config.

**The contradictions found and repaired**

| Where | The contradiction | Repair |
|---|---|---|
| `BUILD_STATE.md` | The authenticated matrix was called both "RUN AND IS GREEN" and "written but **unrun**", eleven lines apart | One scoped statement: the run is real, it belongs to the commit it ran at, and at this baseline the matrix is *not run* |
| `launch-go-no-go-v10.md` §1 | `npm run test:e2e:journey` listed "not run — no seeded env" one row above a row reporting the same command green | v10 left verbatim as history and marked SUPERSEDED; v11 states it once |
| `launch-go-no-go-v10.md` §6 | "four owner-run items", then three listed | The count is now derived from the manifest and asserted by a test |
| `BUILD_STATE.md` §2 gap 5 | Said `/api/health/ready` validates only migrations `020`/`021`; MW-V10-00 had already fixed it | Closed, with what the probe actually does |
| `BUILD_STATE.md` §2 gap 8 | Said refund/dispute webhooks unhandled; both cases are in the switch (verified in the code) | Closed |
| `BUILD_STATE.md` §5 | "618 tests green" against 900 elsewhere, and a duplicated verdict | Verdict no longer duplicated — it lives in the manifest only |

**The substantive finding.** The v10 authenticated E2E evidence (87 executions,
green, against a deployed preview) is real but was produced at an earlier
commit. Carrying it forward would certify code it never ran against, so it is
recorded as **not run at this baseline** and reopened as `P1-AUTH-E2E-AT-HEAD`
for MW-V11-04. The historical record is not rewritten.

**Two real defects confirmed in the code** while establishing truth, both left
for the prompts that own them:

- `src/app/page.tsx:227` — `{TERMS.promise} Tell Mellowa…` is a JSX expression
  followed by newline-indented text, so JSX drops the whitespace and the hero
  renders `you actually have.Tell Mellowa`. (`P1-COMMERCIAL-COPY`, MW-V11-01)
- `src/lib/stripe/trial-experiment.ts` — `trialOfferSentence(3)` returns
  "a **3 days** trial" and `startTrialCta(3)` returns "Start **3 days** free".
  (`P1-COMMERCIAL-COPY`, MW-V11-01)
- `e2e/public.spec.ts:133` returns `null` for any control inside `<header>`, so
  the 44px rule never sees the header at all. (`P1-HEADER`, MW-V11-02)

**Changed files**

| Area | File | What |
|---|---|---|
| Release truth | `src/lib/release/manifest.ts` | New. Types, status vocabulary and the pure validator |
| Release truth | `docs/release/manifest.v11.json` | New. The canonical manifest |
| Evidence | `docs/release/evidence/v11/*.txt` | New. Raw logs for every gate run at the baseline |
| Docs | `docs/launch-go-no-go-v11.md` | New. Active scorecard, checked against the manifest |
| Docs | `docs/BUILD_STATE.md` | Repaired; points at the manifest as active truth |
| Docs | `docs/launch-go-no-go-v10.md` | Banner only — marked SUPERSEDED, content untouched |
| Tests | `tests/release-manifest.test.ts` | New. 42 tests: validator fixtures + document agreement |
| Scripts | `package.json` | Added `npm run release-manifest` |

**Migrations / config / flags:** none. **Analytics impact:** none. No product
code was changed by this slice.

**Commands**

| Command | Result |
|---|---|
| `npm run lint` | local pass — 0 errors, 8 pre-existing warnings in untouched files |
| `npm run typecheck` | local pass |
| `npx vitest run` | local pass — **942 passed / 82 files** (900 at baseline + 42 new) |
| `npm run eval` | local pass — 81 passed |
| `npm run build` | local pass |
| `npm run test:e2e:public` | local pass — **51 passed** across desktop / 375px / 320px |
| `npm run release-manifest` | local pass — 42 passed |
| `git diff --check` | clean |
| `npm run test:e2e` / `:journey` | **not run** — no seeded environment here |

**Rollback:** delete the four new files, revert the `BUILD_STATE.md` and
`launch-go-no-go-v10.md` edits and the one `package.json` line. No product
behaviour, schema or flag is involved.

**Assumptions:** the baseline suite numbers recorded in the manifest were
measured on a clean tree at `169c706` before this slice added tests; they are
re-measured at the frozen candidate in MW-V11-08.

**Open blockers after this prompt:** `P0-LIVE-TRANSACTION`,
`P1-REMINDER-REHEARSAL`, `P1-ROTATION-RESTORE` (all owner-run),
`P1-AUTH-E2E-AT-HEAD`, `P1-HEADER`, `P1-COMMERCIAL-COPY` (engineering),
`P2-DENIAL-COUNTING`, `P2-REMINDER-OPTOUT-SURFACE`.

---

## MW-V11-01 — Centralize and correct trial, sample and hero language

**Outcome:** done. `P1-COMMERCIAL-COPY` closed. Both defects named in the prompt
reproduced exactly as described, were fixed at the helper level, and are now
asserted **on the rendered page** rather than only in the source.

**Reproduced before changing anything** (curl against a local production build):

- Hero rendered `…the day you actually have.<!-- -->Tell Mellowa…` — no space.
  Cause: `{TERMS.promise}` followed by prose that wraps onto the next line. JSX
  discards the whitespace between an expression and an adjacent text node that
  spans lines, so the space vanished when the paragraph wrapped. Invisible in
  the source; that is why a 900-test suite never saw it.
- Helper line rendered `No card for the sample. Premium starts with a 3 days
  trial when you choose a plan. An account is required; no card is requested for
  the sample.` — an ungrammatical length **and** the no-card fact stated twice
  in one paragraph.

**Fixes**

| What | How |
|---|---|
| Missing hero whitespace | New `joinSentences()` in `terminology.ts` composes the paragraph in JavaScript, so it is one text node and the spacing cannot be lost to a re-wrap, a formatter or translation |
| "a 3 days trial" | `trialOfferSentence` now uses the attributive form via a new `trialNounPhrase()` → "a 3-day trial". The article is chosen by how the number is spoken, so "an 8-day trial" is right if a variant is ever added |
| "Start 3 days free" | `startTrialCta` → "Start free 3-day trial" |
| "Free sample and 3 days trial" (refund page) | Switched to `trialLengthAdjective` — a third instance of the same error, found by the audit rather than reported |
| Duplicate no-card disclosure | `TERMS.sampleHelper` now states both facts once: "An account is required for the free sample, and no payment card is requested for it." The hero's trailing restatement is deleted |

**Verified in the browser after the fix:**
`A realistic wellbeing plan for the day you actually have. Tell Mellowa…` and
`An account is required for the free sample, and no payment card is requested
for it. Premium starts with a 3-day trial when you choose a plan.`

**Not changed, deliberately.** The prompt quotes the canonical promise as "A
realistic plan for the day you actually have."; the code says "A realistic
**wellbeing** plan…". Left as-is: the qualifier is the general-wellbeing scoping
the product contract requires elsewhere, and dropping it would weaken a safety
boundary to match a paraphrase. Flagged rather than silently applied.

**Changed files**

| Area | File | What |
|---|---|---|
| Copy helpers | `src/lib/stripe/trial-experiment.ts` | `trialNounPhrase()` + article selection; `startTrialCta` and `trialOfferSentence` use the adjective form |
| Copy helpers | `src/lib/content/terminology.ts` | `joinSentences()`; `sampleHelper` states both facts once |
| Landing | `src/app/page.tsx` | Hero, sample helper and offer paragraphs composed via `joinSentences` |
| Legal | `src/app/refund/page.tsx` | Attributive form in the section heading |
| Tests | `tests/commercial-copy.test.ts` | New. 30 contract tests: singular/plural, article, whitespace, duplication, sample-vs-trial, metadata/JSON-LD |
| Tests | `e2e/public.spec.ts` | New rendered-text assertions across `/`, `/pricing`, `/refund`, `/terms` |
| Tests | `tests/trial-experiment.test.ts`, `tests/content-audit.test.ts`, `tests/landing-conversion.test.ts`, `e2e/journeys.spec.ts` | Updated assertions that pinned the old strings or the old JSX shape |
| Release | `src/lib/release/manifest.ts`, `tests/release-manifest.test.ts` | Added `closedBlockers`, so a closure records what closed it and what proves it instead of a blocker silently disappearing |
| Docs | `docs/release/manifest.v11.json`, `docs/launch-go-no-go-v11.md` | `P1-COMMERCIAL-COPY` moved to closed with evidence |

**Migrations / config / flags:** none. **Analytics impact:** none — no event,
property or surface code changed. Trial eligibility, length, price and charge
date remain server-owned; the helpers only format what the server supplies.

**Commands**

| Command | Result |
|---|---|
| `npm run lint` | local pass — 0 errors, same 8 pre-existing warnings |
| `npm run typecheck` | local pass |
| `npx vitest run` | local pass — **978 passed / 83 files** |
| `npm run eval` | local pass — 81 passed |
| `npm run build` | local pass |
| `npm run test:e2e:public` | local pass — **57 passed** (51 baseline + 6 new) |
| `npm run release-manifest` | local pass — 46 passed |
| `git diff --check` | clean |

**Five test failures during the work were my own, not the product's:** three
brittle source-shape assertions (`toContain("{TERMS.promise}")`), one wrong env
fixture, and two comments of mine that quoted the defect literally and tripped
the existing "no hardcoded trial length" guard. That guard doing its job on my
comment is a point in its favour; all six were fixed in the tests and comments,
not by weakening a check.

**Rollback:** revert the five source files. No schema, flag or persisted data is
involved, so a revert is complete and immediate.

**Open blockers after this prompt:** `P0-LIVE-TRANSACTION`,
`P1-REMINDER-REHEARSAL`, `P1-ROTATION-RESTORE` (owner-run),
`P1-AUTH-E2E-AT-HEAD`, `P1-HEADER` (engineering), `P2-DENIAL-COUNTING`,
`P2-REMINDER-OPTOUT-SURFACE`.

---

## MW-V11-02 — Accessible compact header with no test exemption

**Outcome:** done. `P1-HEADER` closed. The exemption is gone, the header is held
to the same rule as every other public control, and the row still does not wrap
at any supported width.

**The insight that unlocked it: height is free, width is not.** MW-V10-07 gave
every nav link a 44px box, which made the row too *wide* for a 320px phone; it
wrapped, the owner rejected it on sight, and the header was reverted with the
test amended to skip anything inside `<header>`. So the targets were never
fixed — they were made invisible to their own test. A 44px-tall target costs
nothing horizontally. What genuinely does not fit on a 320px screen is the
*number* of links, and that is a job for a disclosure, not for shrinking
targets or hiding pricing.

**Accessibility contract now encoded** (stated in the component and asserted in
the browser, rather than implied):

- Every header target is ≥44×44 CSS px — WCAG 2.2 SC 2.5.5, the same rule the
  rest of the public pages meet. No exemption.
- The row never wraps at 320, 360, 375, 768, 1024 or 1440, nor at 200% zoom, and
  the page never scrolls horizontally at any of them.
- Below 640px the two genuinely secondary links (How it works, Pricing) move
  into one disclosure. The primary action and sign-in stay visible at every
  width. Nothing is removed.
- The menu button exposes `aria-expanded`, names its controlled region via
  `aria-controls`, closes on Escape and on an outside click, and returns focus
  to itself. No focus trap — it is a disclosure, not a modal.

**A real layout bug found and fixed during the work.** The first build rendered
*every* link at 320px despite `hidden sm:inline-flex`. Cause: the shared base
class began with `inline-flex`, and between two base-layer display utilities the
one Tailwind emits later wins regardless of class order — so `hidden` never
applied. Measured, not guessed: the page was 376px wide inside a 320px viewport.
The base class now carries no display utility at all and each element sets its
own, which is also where the responsive intent is readable.

**Measured widths after the fix** (`scrollWidth` equals the viewport at every
width, i.e. no overflow):

| Width | Visible header targets |
|---|---|
| 320 / 360 / 375 | Mellowa 60, Menu 51, Sign in 59, Free sample 102 |
| 400 | Mellowa 60, Menu 51, Sign in 59, Create my sample 138 |
| 640+ | Mellowa 75, How it works 95, Pricing 59, Sign in 59, Create my sample 146 |

**One deliberate compromise, recorded rather than hidden.** The CTA carries two
label lengths for one destination: "Free sample" below 400px, "Create my sample"
at and above it. A 320px row cannot hold the wordmark, a disclosure, sign-in and
a sixteen-character CTA without either wrapping or dropping a target below 44px,
and both are the defects this component exists to prevent. The unused label is
`display:none`, so the accessible name is always exactly what is on screen —
never both at once, and never an icon without text.

**Changed files**

| Area | File | What |
|---|---|---|
| Landing | `src/components/dailyflow/landing-header.tsx` | New. The header, its disclosure and the contract it encodes |
| Landing | `src/app/page.tsx` | Inline header markup replaced by the component |
| Tests | `e2e/public.spec.ts` | Header exemption deleted from the 44px rule; six header tests added covering geometry, wrapping, overflow, 200% zoom, reachability at 320px, keyboard operation and accessible names |

**Migrations / config / flags:** none. **Analytics impact:** none — the header
CTA was and remains an untracked `Link`; no event or property changed. Header
state is local presentation state and never leaves the browser.

**Commands**

| Command | Result |
|---|---|
| `npm run lint` | local pass — 0 errors, same 8 pre-existing warnings |
| `npm run typecheck` | local pass |
| `npx vitest run` | local pass — **978 passed / 83 files** |
| `npm run build` | local pass |
| `npm run test:e2e:public` | local pass — **72 passed** across desktop / 375px / 320px |
| `npm run release-manifest` | local pass — 46 passed |
| `git diff --check` | clean |

**Three test failures during the work were mine, not the product's:** a
strict-mode locator that matched both the inline and the in-panel copy of the
Pricing link, an accessible-names test that expected the secondary links to be
visible at a width where they live in the closed disclosure, and a
`toHaveCount(0)` that counted DOM presence rather than visibility. Fixed in the
tests. The genuine product defect found was the Tailwind display conflict above.

**Rollback:** revert `page.tsx` to the inline header and delete the component;
the e2e header tests would then fail, which is the intended behaviour — the
exemption is not coming back silently.

**Open blockers after this prompt:** `P0-LIVE-TRANSACTION`,
`P1-REMINDER-REHEARSAL`, `P1-ROTATION-RESTORE` (owner-run),
`P1-AUTH-E2E-AT-HEAD` (engineering), `P2-DENIAL-COUNTING`,
`P2-REMINDER-OPTOUT-SURFACE`.

---

## MW-V11-03 — Shorter premium landing with truthful real-product proof

**Outcome:** done, with one target missed on purpose. The landing now *shows*
the adaptation loop instead of describing it, three overlapping sections were
consolidated into one, and every mandatory disclosure survived. Visible copy
went from **753 to 677 words (−10.1%)** against a 15–20% target — see the
shortfall below, which is recorded rather than closed by cutting protected copy.

**The proof.** `AdaptiveDayProof` is a server component that renders the four
beats using the product's own vocabulary: "Today · one next step" → "Then the
day changes" (a reason chip) → "What will change" with the real
`Can change / Kept / Already done` counts and the "Already done — kept" and
"Kept — won't change" chips → "Rest of today adjusted" with
"Undo — bring the previous plan back".

Three constraints, each with a test:

- **Nothing real.** The fixture is written in the file; the component cannot
  fetch, and a test asserts it never gains a `fetch`, a Supabase client or an
  `await`.
- **Not a fake product.** The chips are spans, not buttons. A mock control that
  takes focus and does nothing is worse for keyboard and screen-reader users
  than an honest picture, so it is a `<figure>` with a caption saying what it
  is. A browser test asserts the figure contains zero focusable elements.
- **Nothing moves**, so there is nothing to suppress under reduced motion, and
  every state chip carries a border rather than colour alone so it survives
  forced-colors mode.

`tests/landing-proof.test.ts` is the claim-to-behaviour audit: every label the
proof shows is checked against `today-plan-v2.tsx`. If the product renames a
control, the marketing illustration fails the build rather than quietly
advertising a screen that no longer exists.

**Consolidation — three sections became one.** All three were making the same
claim in different registers:

| Removed | Why it was duplication |
|---|---|
| "Your day changes. Most plans don't." panel | Restated the wedge that the proof now demonstrates |
| "One real day, start to finish" (8 items, 164 words) | A second example day; the proof already shows one, with the states that make it Mellowa rather than a schedule |
| "How personalization works" + "What the AI does" cards | Two cards answering one question; merged into "How it decides" |
| Third "Fewer decisions" bullet | Said the removable-learning fact a third time; it now appears once, in the merged card |

The `#sample-plan` anchor went with the sample-day section, so the hero's
secondary CTA now points at `#how-it-works` and reads "See how it adapts". A
test now derives every in-page anchor from the source and asserts each has a
target, rather than pinning a list that goes stale.

**Section map, before → after (visible words)**

| Section | Before | After |
|---|---|---|
| Hero | 111 | 100 |
| Trust strip | 18 | 18 |
| What happens when your day changes (proof) | — | 210 |
| One real day, start to finish | 160 | removed |
| Your day changes. Most plans don't. | 44 | removed |
| Who it's for / not for / how it decides | 105 | 100 |
| Not more wellness tasks. Fewer decisions. | 35 | folded into the cards |
| What Premium keeps doing | 95 | 74 |
| See one day before you choose a plan. | 116 | 106 |
| Questions, answered | 50 | 50 |
| Give today a clearer shape. | 19 | 19 |
| **Total** | **753** | **677** |

**The missed target, and why I did not close it.** Removing the "every plan
covers…" category list would have reached 15%. I removed it, and the suite
failed: `landing-conversion.test.ts` pins that list as a contract. It is right
to. An example day proves the format exists; only the enumeration proves nothing
has quietly been dropped from what a plan produces, and that is a completeness
statement a prospective buyer is entitled to. I restored the list and left the
target missed — the same call MW-V10-01 made for the same reason. Excluding the
210-word proof that did not exist before, pre-existing copy fell about 38%.

**Two intermittent failures seen, neither reproduced.** Recorded as
`P2-SUITE-FLAKES` rather than silenced: `tests/email-templates.test.ts` failed
once under full-suite load taking 6.1s for a normally instant assertion, and the
public keyboard-tabbing journey hit its 60s timeout once on desktop. Both passed
on re-run — email-templates three consecutive times, the full public suite
twice. The acceptance criterion explicitly forbids closing these with a retry or
a longer wait. MW-V11-04 owns the investigation.

**Changed files**

| Area | File | What |
|---|---|---|
| Landing | `src/components/dailyflow/adaptive-day-proof.tsx` | New. The four-beat proof, synthetic fixture, no client JS |
| Landing | `src/app/page.tsx` | Hero split into a 3-beat flow plus a trust subrow; proof section added; two sections and one card removed; Premium and offer copy tightened |
| Tests | `tests/landing-proof.test.ts` | New. 29 tests: claim-to-behaviour audit, honesty, non-interactivity, anchors, disclosure survival |
| Tests | `e2e/public.spec.ts` | Browser check that the proof renders truthfully, fits 320px and contains no focusable controls |
| Tests | `tests/landing-conversion.test.ts` | Hero beat list updated for the 3+2 split; one source regex made whitespace-tolerant |
| Docs | `docs/release/manifest.v11.json`, `docs/launch-go-no-go-v11.md` | Public-suite counts, the copy shortfall, and `P2-SUITE-FLAKES` |

**Migrations / config / flags:** none. **Analytics impact:** none — the proof
tracks nothing and carries no CTA. Signup CTA count in `main` is unchanged at 2.

**Commands**

| Command | Result |
|---|---|
| `npm run lint` | local pass — 0 errors, same 8 pre-existing warnings |
| `npm run typecheck` | local pass |
| `npx vitest run` | local pass — **1007 passed / 84 files** |
| `npm run build` | local pass |
| `npm run test:e2e:public` | local pass — **75 passed** across desktop / 375px / 320px |
| `npm run release-manifest` | local pass — 46 passed |

**Rollback:** revert `page.tsx` and delete the proof component and its two test
files. No schema, flag or persisted data is involved.

**Open blockers after this prompt:** `P0-LIVE-TRANSACTION`,
`P1-REMINDER-REHEARSAL`, `P1-ROTATION-RESTORE` (owner-run),
`P1-AUTH-E2E-AT-HEAD` (engineering), `P2-DENIAL-COUNTING`, `P2-SUITE-FLAKES`,
`P2-REMINDER-OPTOUT-SURFACE`.

---

## MW-V11-04 — Re-certify at current head and harden test integrity

**Outcome:** the code half is done; the execution half is blocked and stays
blocked. `P1-AUTH-E2E-AT-HEAD` remains **open** — I cannot close it, because
running those suites needs a seeded Supabase environment this session does not
have, and Claude Code must not point them at live Supabase. What I could do was
make them worth running, and fix a defect that meant one of them was not.

### The defect: a required test that had stopped testing anything

`e2e/journeys.spec.ts` located the trial CTA with `/start \d+ days? free/i` —
the wording from **before** MW-V11-01 renamed it to "Start free N-day trial".
That locator now matches nothing, so `count()` is 0, so `priorTrial` is true, so
`test.skip(priorTrial, "seeded user has already consumed their trial")` fires.
The test would have skipped for every user, forever, reporting no failure and
providing no coverage of the trial-length disclosure contract.

A second copy of the same stale pattern was gating the prior-trial billing test.
Both are fixed, and both now also assert the adjective form ("3-day trial")
agrees with the assigned number — the surface MW-V11-01 changed.

**This is my own regression from MW-V11-01**, missed because I updated the one
occurrence I had grepped for and not the two behind conditional skips. It is
also the exact failure mode this prompt is about: a stale locator behind a skip
does not fail, it just stops testing, and nothing in a green suite reveals it.

`tests/e2e-integrity.test.ts` now makes that class of defect impossible to
reintroduce quietly. It runs in the *unit* suite — deliberately, because it has
to hold precisely when the browser environment is absent and the browser suites
cannot defend themselves. It asserts no spec matches a superseded CTA pattern,
derives the current wording from the helper rather than restating it, requires
every computed `test.skip` to live in a file that also asserts page identity,
and forbids `.only`.

### Identity and failure guards

New `e2e/support/harness.ts`, shared by both authenticated suites. Two things
are now mandatory before a journey asserts anything — proof of *where* you are
and *who* you are — and one after: proof that nothing failed quietly.

| Guard | What it catches |
|---|---|
| `assertIdentity` | Wrong route, and specifically a silent redirect to `/login` from an expired session — the case where a test that checks for the *absence* of an element passes forever on the sign-in page |
| `assertSeededState` | A fixture that did not apply. Replaces skipping on an unexpected state: a skip there is indistinguishable from a broken seed and silently removes coverage |
| `assertNoErrorBoundary` | The v10 case exactly — Today crashed into the error boundary because the fixture used the wrong field names, and the matrix asserted against the error screen |
| `installFailureGuards` / `assertNoBackgroundFailures` | Uncaught exceptions, console errors, and unexpected 4xx/5xx. A journey that "passes" while a required call returned 500 and the UI rendered an empty state is not evidence |
| `annotateRetry` | A test that only passed on attempt 2 is recorded as a finding, not a pass |

The expected-failure allowlist is two entries and a test caps its growth and
forbids `.*` in it — a broad allowlist would restore the blindness the guards
remove. Guards assert only on otherwise-passing tests, so on a real failure the
console noise is not reported over the actual cause.

All eight seeded states in the daily-journey matrix now go through
`arriveAtToday(page, state, signature)`, which logs in, proves the route, and
proves the fixture applied — before any state assertion runs.

### What was actually run

| Command | Result |
|---|---|
| `npx vitest run` | local pass — **1029 passed / 86 files**, run twice consecutively |
| `npm run test:e2e` (full matrix) | **75 passed, 45 skipped, exit 0** |
| `npm run test:e2e:public` | local pass — 75 across desktop / 375px / 320px |
| `npm run lint` | local pass — 0 errors, same 8 pre-existing warnings |
| `npm run typecheck` | local pass |
| `npm run release-manifest` | local pass — 46 passed |

**`npm run test:e2e` exits 0 while skipping 45 required tests.** Worth stating
plainly: the command that is supposed to certify the authenticated product
returns success having run none of it. CI already handles this — `RC_GATE` turns
an unrun authenticated suite into a hard error — but it is why the manifest
records `blocked` rather than reading an exit code, and why the verdict is
unchanged.

### The flakes, diagnosed but not closed

`P2-SUITE-FLAKES` is downgraded, not closed. Both failures happened while a
production build was running concurrently on this machine, and the email one
spent 6.1 seconds inside assertions that are pure `Intl` formatting — consistent
with CPU starvation. Neither reproduced on a quiet machine: the unit suite is
green twice consecutively and the full browser matrix is green with nothing else
running.

I did **not** change `billing-facts.ts` to memoize the `Intl` formatters. The
contention diagnosis is circumstantial, and editing product code on a hypothesis
to make a flake go away is how a real defect gets buried. It stays open for
re-observation in CI.

**Changed files**

| Area | File | What |
|---|---|---|
| E2E | `e2e/support/harness.ts` | New. Shared login, identity/seeded-state assertions, background failure guards, retry annotation |
| E2E | `e2e/journeys.spec.ts` | Stale CTA locators fixed; identity assertions; guards; adjective-form agreement asserted on billing |
| E2E | `e2e/daily-journey.spec.ts` | Uses the shared harness; all eight states assert identity and fixture application |
| Tests | `tests/e2e-integrity.test.ts` | New. 22 tests protecting the browser suites from silent decay |
| Docs | `docs/release/manifest.v11.json`, `docs/launch-go-no-go-v11.md` | Authenticated suites recorded `blocked` with counts; suite totals; flake diagnosis |

**Migrations / config / flags:** none. **Analytics impact:** none. No product
code changed in this slice — the one product-adjacent fix was in test locators.

**Rollback:** revert the three e2e files and delete the harness and integrity
test. No product behaviour is involved.

**Open blockers after this prompt:** unchanged — `P0-LIVE-TRANSACTION`,
`P1-REMINDER-REHEARSAL`, `P1-ROTATION-RESTORE` (owner-run),
`P1-AUTH-E2E-AT-HEAD` (needs a seeded environment), `P2-DENIAL-COUNTING`,
`P2-SUITE-FLAKES`, `P2-REMINDER-OPTOUT-SURFACE`.

### MW-V11-04 addendum — the authenticated suites actually ran

The owner confirmed Supabase is live and authorised using a synthetic account in
that project. Two further defects came out of trying to use it, and six
authenticated journeys now genuinely execute.

**Defect 3: Playwright never loaded `.env.local`.** Next.js loads it for the app
and `seed-test-user.mjs` has its own loader, but the test runner process had
neither — it read `process.env` only. So putting `E2E_SUPABASE_TEST`,
`E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` in `.env.local`, which is the obvious
place and the file every other part of the repo reads, configured **nothing**.
The suite skipped while looking correctly configured, and the failure mode was
silence rather than an error. This is a large part of why these suites went so
long without ever running. `playwright.config.ts` now loads `.env.local`, with
real environment variables still winning so CI secrets are unaffected.

**Defect 4: two required journeys were unreachable by any fixture.** Every one
of the eight seed states wrote a `subscriptions` row with status `trialing` or
later. A trial-eligible user (no subscription at all) and a prior-trial user
(`trial_used_at` set, subscription ended) could not be produced. So:

- "assigned trial length is disclosed identically on pricing and billing" needed
  a trial CTA that no fixture could ever show;
- "a user who already used their trial sees pay-today copy only" needed a state
  the v10 comment on that very test described — "seed `--state=canceled` with
  `trial_used_at` set" — and which had never been implemented.

Both skipped on every run since they were written, and both skips read as
deliberate decisions. Added `--state=trial-eligible` and `--state=trial-used`.

**Skips are now fixture-driven, not page-driven.** Both tests used to infer
whether to run by reading the page: "no trial CTA visible, so this user must
have used their trial, so skip". That guess is unfalsifiable — a stale locator,
a broken seed and a genuinely ineligible user are indistinguishable, and all
three produce a skip. They now key off `E2E_SEED_STATE`, so a skip can only mean
"the fixture I need was not seeded" and it prints the exact command to seed it.
When the fixture *is* loaded, the old skip conditions became assertions.

**Result:** `npx playwright test e2e/journeys.spec.ts` → **6 passed, 6 skipped**
across desktop / 375px / 320px, against the live Supabase project as
`test@mellowa.local`. Login, settings data controls and pricing trial state are
the first authenticated journeys to genuinely execute at this baseline.

**Still outstanding, and why.** Running `scripts/seed-test-user.mjs` is blocked
in this session by the permission classifier — it writes to a live database with
the service-role key, which is a reasonable thing to stop. I did not work around
it. So the eight-state daily-journey matrix and the two new fixture states have
not been executed. `P1-AUTH-E2E-AT-HEAD` stays **open**.

To finish it, the owner runs the seed once per state; the suites then run
unattended. `.env.local` gained the three `E2E_*` variables (backup at
`.env.local.bak-v11`); it is gitignored, so nothing is committed.

**Additional changed files**

| File | What |
|---|---|
| `playwright.config.ts` | Loads `.env.local` into the runner; real env still wins |
| `scripts/seed-test-user.mjs` | Two new states: `trial-eligible` (no subscription row) and `trial-used` (`trial_used_at` set, subscription canceled) |
| `e2e/support/harness.ts` | `SEEDED_STATE` and `needsState()` — a skip names its missing fixture |
| `e2e/journeys.spec.ts` | Both state-guessing skips replaced with fixture-driven ones; old skip conditions promoted to assertions |
| `tests/release-manifest.test.ts` | Authenticated evidence may now pass, but only for the SHA it ran at; skipped counts must stay visible; the blocker must stay open while any required journey is unrun |

---

## MW-V11-05 — Core Web Vitals and interaction polish

**Outcome:** performance is measured for the first time in this project's
history, and all three launch-path routes are inside budget.

| Route | LCP | CLS | TTFB | Transferred | JS |
|---|---|---|---|---|---|
| `/` | **812ms** | 0 | 15ms | 192,732 B | 159,992 B |
| `/pricing` | **600ms** | 0 | 16ms | 190,675 B | 166,120 B |
| `/signup` | **612ms** | 0 | 90ms | 265,622 B | 239,438 B |

Budgets: LCP ≤2500ms, CLS ≤0.1, TTFB ≤800ms. Conditions: 4× CPU throttle,
~Slow 4G, cold browser cache against a warmed server. Raw report at
`docs/release/evidence/v11/perf/vitals.json`; re-runnable with `npm run perf`.

### The finding: 53KB of fonts that render nothing

`layout.tsx` loaded Geist and Geist_Mono and exposed them as CSS variables,
which `globals.css` mapped to Tailwind's `--font-sans` / `--font-mono`. But **no
component uses `font-sans`**, only one word uses `font-mono` ("DELETE" in the
account-deletion confirmation), and `globals.css` sets
`body { font-family: Arial, Helvetica, sans-serif }` — which wins.

So the product has been rendering in Arial the whole time while downloading
52,996 bytes of webfonts it never painted, on every page, on the critical path.
Removing them cut the landing page from **246,924 to 192,732 transferred bytes
(−22%)** with **no visual change**, because nothing was using them.

I did **not** adopt Geist properly, which would also have "fixed" it. Changing
the typeface of every screen in the product is a design decision, not launch
hardening, and the brand may or may not want it. Recorded as
`P2-BRAND-TYPEFACE` for the owner instead.

### Three measurement bugs I made and fixed

Worth recording, because each one produced a plausible number that was wrong:

1. **Cold-start measured as page performance.** The first run reported landing
   LCP 4080ms and pricing TTFB 956ms. Both were the server's first-request
   start-up, not the page: the same route measured 840ms warm. A 5× difference
   entirely from what was being measured. Fixed by warming the route first, and
   cold-start is now recorded as its own risk rather than silently included or
   silently dropped.
2. **Byte accounting read from response headers**, which report no
   `content-length` for compressed responses — so it claimed 0 bytes of
   JavaScript on a page that ships 160KB. Fixed by using the Resource Timing
   API's `transferSize`.
3. **Warming by navigating twice**, which warmed the browser cache as well as
   the server and reported 15KB transferred instead of 247KB — measuring a
   returning visitor while claiming to measure a first visit. Fixed by warming
   through `page.request`, which shares cookies but not the page's HTTP cache.

### What is deliberately still open

- **INP is not measured** (`P2-INP-UNMEASURED`). It needs real interactions over
  a session. The suite records a click-to-paint probe on the header disclosure
  (14–41ms) and labels it a proxy; a test asserts the manifest and the raw
  report both say INP is not measured, because that is the most tempting
  misstatement available here.
- **Cold start** (`P2-COLD-START`): 4080ms LCP cold versus 812ms warm, and
  unmeasured against the real deployment. A first-time visitor hitting a cold
  function is exactly the visitor the landing page exists for.

CLS is 0 on all three routes, so the "it moved as I tapped" failure is absent —
that one needed no work.

**Changed files**

| Area | File | What |
|---|---|---|
| Perf | `e2e/perf.spec.ts` | New. Throttled LCP/CLS/TTFB/bytes/long-task collection, budgets, labelled interaction probe, JSON report |
| Perf | `playwright.config.ts` | `perf` project so `npm run perf` is cross-platform without a cross-env dependency; viewport projects ignore the spec |
| App | `src/app/layout.tsx` | Both webfonts removed |
| App | `src/app/globals.css` | `--font-sans` / `--font-mono` resolve to platform stacks |
| Scripts | `package.json` | `npm run perf` |
| Tests | `tests/release-manifest.test.ts` | A perf claim needs its raw report; INP must never be claimed |

**Migrations / config / flags:** none. **Analytics impact:** none — no telemetry
was added. The perf report contains route templates and numbers only: no URLs
with query strings, no user content, no device identifiers.

**Commands**

| Command | Result |
|---|---|
| `npm run lint` | local pass — 0 errors, same 8 pre-existing warnings |
| `npm run typecheck` | local pass |
| `npx vitest run` | local pass — **1034 passed / 85 files** |
| `npm run build` | local pass |
| `npm run test:e2e:public` | local pass — **75 passed** |
| `npm run perf` | local pass — 4 passed, all budgets met |
| `git diff --check` | clean |

**Rollback:** restore the two font imports in `layout.tsx` and the two variable
mappings in `globals.css`; delete `e2e/perf.spec.ts` and the `perf` project. No
schema, flag or persisted data is involved.

**Open blockers after this prompt:** `P0-LIVE-TRANSACTION`,
`P1-REMINDER-REHEARSAL`, `P1-ROTATION-RESTORE` (owner-run),
`P1-AUTH-E2E-AT-HEAD`, plus P2s: `P2-DENIAL-COUNTING`, `P2-COLD-START`,
`P2-INP-UNMEASURED`, `P2-BRAND-TYPEFACE`, `P2-SUITE-FLAKES`,
`P2-REMINDER-OPTOUT-SURFACE`.

---

## MW-V11-06 — Rehearse real billing, reminders, cron and lifecycle email

**Outcome:** both owner-run rehearsals are now executable and gated. Neither is
executed — they need real money and a real inbox, and Claude Code must not touch
either. `P0-LIVE-TRANSACTION` and `P1-REMINDER-REHEARSAL` stay **open**.

**What I did not do: rebuild v10's work.** The reminder planner already enforces
consent versioning, safety suppression ahead of every other rule, `past_due` and
`canceled` suppression, DST-correct local scheduling, quiet hours wrapping
midnight, a planner-owned dedupe key and cron run leases — with fixtures for all
of it in `tests/reminder-reliability.test.ts`. The cron and outbox are already
idempotent and bounded. I verified those and left them alone.

What was missing was not mechanism but **usability of the rehearsals**: a
checklist with no abort condition, no cleanup and no place to write what actually
happened produces an afternoon of live work and no usable evidence.

### Live transaction runbook

- **Expected *and* observed columns** for all 16 steps. A single "expected"
  column invites ticking rather than reading; now a divergence has somewhere to
  go, and the result section says a divergence is FAIL even if the flow finished.
- **Six abort conditions**, led by the one that matters most: any charge on a
  date or of an amount the user was not shown. Also a reconcile report
  containing `adoptedSubscriptions`, which means webhooks are dropping and people
  are paying without access.
- **Alert thresholds** deliberately set at "any" — it is one synthetic account,
  so a non-zero dead letter or duplicate-customer detection is a signal, not
  noise.
- **Cleanup** that refunds, cancels and deletes *through the in-app deletion
  flow*, so the teardown doubles as evidence for the deletion step instead of
  leaving rows behind via manual SQL.
- **Evidence hygiene**, because this file is committed: opaque Stripe ids and
  timestamps only, never a card number, an address, or a screenshot with plan
  text in it.
- Two steps added that v11 made checkable: the pinned `trial_days` /
  `trial_variant` must be written *before* the Stripe session exists, and the
  charge date shown at checkout must be the same date Stripe uses — not "about
  right".
- Fixed a stale pointer: it referenced `launch-go-no-go-v9.md`, three releases
  behind.

### Reminder rehearsal worksheet

Kept its seven working sections and added:

- **Six abort conditions**, including two reminders for one local day, a
  reminder arriving *before* the chosen local time, and unsubscribe stopping
  billing mail — which would be a legal problem, not a preference.
- **Section 8**: unsubscribe must suppress the right mail *and only* the right
  mail. Cancel the test subscription after opting out and confirm the billing
  email still arrives.
- **Section 9**: cleanup, including restoring the provider key if the failure
  test broke it and confirming the backlog drains.
- **An honest statement of limits.** DST, quiet-hour wrapping, consent
  versioning and safety suppression stay fixture-tested, because reproducing
  them live means waiting for a DST boundary or putting a crisis signal on a real
  account. The live run proves *delivery*: a real message, in a real inbox, at
  the right time, saying the right thing, and the controls stopping it.

### The gate

`tests/rehearsal-readiness.test.ts` (20 tests) holds the runbooks to the
acceptance criteria the way `release-manifest.test.ts` holds the scorecard: both
must name the blocker they close and the current scorecard, cover the full money
and delivery paths, carry stop conditions and cleanup, and — for the transaction
runbook — tell the operator not to write customer data into a committed file.

It also proves the properties the rehearsals *assume*, since a live step is
meaningless if they are false: every template is classified, all billing and
account mail is `transactional` so opting out cannot stop it, and exactly two
templates are `optional` — `daily_reminder` and `onboarding_nudge`.

**Three of my own assumptions were wrong and the tests caught them:** I guessed
the category vocabulary was transactional/**marketing** when the code says
transactional/**optional**; I wrote a delivery-health privacy assertion that
duplicated one already in `reminder-reliability.test.ts` (replaced with a check
that the original still exists, so the dependency is explicit rather than
copied); and I matched runbook prose without collapsing whitespace, so a
line-wrapped sentence failed.

**Changed files**

| Area | File | What |
|---|---|---|
| Runbook | `docs/runbooks/live-transaction-rehearsal.md` | Rewritten: observed columns, stop conditions, thresholds, cleanup, rollback, evidence hygiene, v11 pointers |
| Runbook | `docs/ops-cron.md` | Stop conditions, sections 8 and 9, statement of limits, v11 pointer |
| Tests | `tests/rehearsal-readiness.test.ts` | New. 20 tests gating both runbooks and the code properties they rely on |
| Docs | `docs/release/manifest.v11.json`, `docs/launch-go-no-go-v11.md` | Owner-evidence notes now say what is ready and link the runbook |

**Migrations / config / flags:** none. **Analytics impact:** none. No product
code changed in this slice.

**Commands**

| Command | Result |
|---|---|
| `npm run lint` | local pass — 0 errors, same 8 pre-existing warnings |
| `npm run typecheck` | local pass |
| `npx vitest run` | local pass — **1054 passed / 86 files** |
| `npm run release-manifest` | local pass — 49 passed |
| `git diff --check` | clean |

**Rollback:** revert the two runbooks and delete the readiness test. No product
behaviour is involved.

**Open blockers after this prompt:** unchanged. Both rehearsals are ready to run
and neither has been run — that is the honest state, and no test in this repo can
change it.

---

## MW-V11-07 — Operational resilience and capped beta proof of repeat value

**Outcome:** the rotation/restore drill is now a drill rather than a gesture, and
the beta has predeclared thresholds it can actually be judged against.
`P1-ROTATION-RESTORE` stays **open** — it is owner-run and was not run.

### Restore drill: verifying what survived, not that the app came up

The v10 procedure restored into a scratch project and checked that a page
rendered. That proves the database is reachable, not that the product is safe.
Added a seven-row verification table, each row a thing that must survive:

| Check | Why |
|---|---|
| Row counts per user-owned table | Silent truncation is invisible until a user asks where their week went |
| Every `user_id` resolves to an auth user | Orphaned rows belong to nobody, so RLS cannot protect them |
| `reminder_consent_version` intact | Consent is fail-closed; a NULL restore silently requires re-consent |
| Allergy and dietary fields intact | The hard safety gate — the one partial restore that could hurt someone |
| `subscriptions` map to the same Stripe ids | Losing the mapping means paying users without access |
| Deletion tombstones still deleted | Resurrecting an erased account is a data-protection incident, not a rollback |
| Plan versions restore with their snapshots | A version without its snapshot makes Undo lie |

Also added: **tested versus desired RTO/RPO**, with the blunt line that until the
Tested column is filled the project has no RTO, only an intention. And **what a
restore does not bring back** — Stripe objects (so the database can restore into
disagreement with the payment processor), secrets, cron schedules, email
suppression lists, and anything already handed to the mail provider, which was
sent and will not be un-sent.

### Beta scorecard: numbers written before the data exists

New `docs/beta-scorecard.md`. `docs/beta-research.md` already had the
funnel-to-decision map, interview scripts, experiment rules and hard stops — it
did not have thresholds. This adds them, in four groups: does the sample show
the wedge; does the daily loop recur; will they pay and keep paying; what does
support cost.

The design decisions worth naming:

- **Predeclared, and it says why**: a threshold chosen after seeing the number
  is a description, not a decision.
- **Cohort under 5 reports "—", not 0%.** A zero reads as "broken"; no data
  means unknown, and the two lead to opposite actions.
- **No bare percentages on tiny denominators.** At 50 accounts a trial
  denominator is single digits, so "2 of 4" is required and "50%" is banned.
- **Undo has no threshold and is observed only.** High Undo may mean people
  trust it enough to experiment; optimising it down would punish the feature for
  working.
- **Safety contacts are never a metric to optimise** — each is read by a human.
- **Unknown cost renders as "unknown", never `$0.00`**, because a zero reads as
  free.
- **BLOCKED is the default expansion verdict**, since widening usually happens
  because nobody decided.

Interviews are pinned to three moments — after the first Adjust, the first Week
closeout, and any cancellation — non-clinical throughout, and cancellation is
never delayed or made contingent on answering.

### A sharper diagnosis for `P2-SUITE-FLAKES`, and a real risk inside it

A third suite flaked: `tests/content-system.test.ts` failed once at 5.7s for
assertions that pass in 0.7s in isolation — and this time **nothing was building
in the background**, which weakens the CPU-contention theory I recorded in
MW-V11-04. The common factor across all three is heavy synchronous filesystem
reads under parallel vitest workers.

The more important finding is the risk hiding inside it: **these doc-scanning
tests mostly assert the *absence* of a phrase, and an empty string satisfies
every such assertion.** A read that silently returned nothing would not fail —
it would report a green gate over nothing. That is the same false-green shape
v11 has been removing everywhere else, sitting inside the tests doing the
removing.

The new doc-scanning tests now refuse to assert against a document under 200
characters. The pre-existing ones are **not** audited for this, and that is
recorded in the blocker rather than quietly assumed fine.

**Changed files**

| Area | File | What |
|---|---|---|
| Runbook | `docs/runbooks/key-rotation-and-backup.md` | Restore verification table, tested-vs-desired RTO/RPO, backup exclusions, deletion propagation, no-secrets-in-evidence rule, v11 pointers |
| Docs | `docs/beta-scorecard.md` | New. Predeclared thresholds, no-data semantics, freeze rule, expansion verdict |
| Tests | `tests/resilience-beta.test.ts` | New. 22 tests gating both documents, including that the runbook contains nothing secret-shaped |
| Tests | `tests/rehearsal-readiness.test.ts` | Non-empty guard on document reads |
| Docs | `docs/release/manifest.v11.json`, `docs/launch-go-no-go-v11.md` | Owner-evidence notes, beta scorecard reference, sharper flake diagnosis |

**Migrations / config / flags:** none. **Analytics impact:** none — the
scorecard is read from events that already exist; no new event was added.

**Commands**

| Command | Result |
|---|---|
| `npm run lint` | local pass — 0 errors, same 8 pre-existing warnings |
| `npm run typecheck` | local pass |
| `npx vitest run` | local pass — **1076 passed / 87 files** |
| `npm run release-manifest` | local pass — 49 passed |
| `git diff --check` | clean |

**Rollback:** delete `docs/beta-scorecard.md` and `tests/resilience-beta.test.ts`
and revert the runbook. No product behaviour is involved.

**Open blockers after this prompt:** unchanged.
