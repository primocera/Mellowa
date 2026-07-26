# V11 Execution Plan — for Opus 5

**Source document:** `Mellowa_Launch_Hardening_Claude_Code_Prompts_v11.docx` (repo root).
**Scope: Mellowa prompts only (MW-V11-00 → MW-V11-08).** The Scalvya prompts in the same doc are for a different repo — do not touch them, do not run them here.

## Mission (why we are doing this)

This run has ONE goal, and it has NOT been done yet — do not assume any v11 prompt is already complete:

- Raise **javni UX (public UX)** score from **6.7 → 8.5**
- Raise **produkcijska evidenca (production evidence)** score from **6.7 → 8.5**
- Move the launch verdict from **NO-GO → LAUNCH**

## Operating rules (non-negotiable — these override your instincts)

1. **Execute the prompts. Nothing else.** No experiments, no "improvements" you thought of, no random additions, no refactors, no new features, no new dependencies. If it's not in the prompt text, you don't do it.
2. **If you find a real bug while executing a prompt, fixing it is OK** — smallest possible fix, note it in the log. That is the only sanctioned deviation.
3. **Talk less, do more.** No long essays between steps. After each prompt: a short handoff (what changed, what passed/failed, what's open). That's it.
4. **Do not go rogue.** A previous session drifted, forgot instructions, and added random things. If you feel yourself expanding scope: stop, re-read the current prompt, do only what it says.
5. **Strict order:** MW-V11-00 first (truth baseline), then 01 → 07, then 08 last. Never skip ahead, never reorder.
6. **Never touch live services.** No live Stripe, Supabase, Vercel, Resend, DNS, cron, keys, or production backups. Where a prompt needs a live action, prepare owner-run steps and leave the item OPEN. Blank/missing evidence lines mean "unrecorded", not "done" — leave them for the owner.
7. **Never report an unrun or skipped check as green.** Use the explicit status vocabulary from the doc (not run / blocked / skipped / failed / local pass / CI pass / preview pass / live rehearsed / observed).
8. **Do not rewrite historical evidence** to match current main, and do not reopen or reimplement work already proven in v10.

## Git workflow (differs from the doc — follow THIS)

- **First action:** create branch `v11` from current `main` (HEAD should be `169c706`). All work happens on `v11`.
- The doc says "one prompt = one commit". **Override:** work through the prompts WITHOUT committing per-prompt. Keep a running log file (`V11_RUN_LOG.md`) with per-prompt results instead.
- **At the end of all prompts (after MW-V11-08):** we stop together, review, and THEN commit — along with the "human stuff": summary tables, owner-run checklists, evidence placeholders, launch verdict docs. Do not merge to `main` and do not push without the owner's say-so.
- Never use destructive git commands.

## Per-prompt checklist (repeat for every prompt)

1. Read the full prompt text from the docx section before starting.
2. Confirm current branch/HEAD; note any drift from baseline `169c706`.
3. Inspect existing state first — if something is already correct, **prove it, don't rebuild it**.
4. Implement only the verified gaps as one reviewable vertical slice.
5. Run: `npm run lint`, typecheck, tests, production build, relevant Playwright journeys. `git diff --check`.
6. Append a SHORT structured entry to `V11_RUN_LOG.md`: prompt ID, outcome, changed files, commands run with pass/fail/skip counts, open blockers, assumptions.

## Prompt map (Mellowa)

| # | ID | Outcome (one line) |
|---|----|--------------------|
| 0 | MW-V11-00 | One truthful release baseline at actual current main; fix contradictory v10 docs; release manifest + validator |
| 1 | MW-V11-01 | Fix trial/sample/hero copy: whitespace bug, "a 3 days trial" grammar, duplicate no-card wording; central grammar-safe helpers |
| 2 | MW-V11-02 | Single-row header with accessible 44px targets; remove the header test exemption |
| 3 | MW-V11-03 | Shorter landing (−15–20% copy) with truthful product proof of the adaptation loop |
| 4 | MW-V11-04 | Rerun full public+authenticated E2E at current head; harden against false-green tests |
| 5 | MW-V11-05 | Core Web Vitals: measure, budget (LCP ≤2.5s, CLS ≤0.1, INP ≤200ms p75 mobile), fix measured bottlenecks |
| 6 | MW-V11-06 | Billing/reminder/cron/email rehearsal runbooks — owner-run live steps stay OPEN |
| 7 | MW-V11-07 | Key-rotation + backup/restore drills (owner-run), capped ≤50-user beta scorecard |
| 8 | MW-V11-08 | Freeze final RC, full gate run, separate beta vs public-paid verdicts — LAST, nothing after it |

## Hard boundaries from the product contract

- Prices stay €9.99 monthly / €59.99 yearly; default trial stays 3 days; sample entitlement unchanged.
- Safety classification before every AI generation, fail-closed. No safety/allergen gate weakening, ever.
- No streaks, scores, shame language, fake scarcity, "unlimited", medical/therapy claims.
- No PII, plan text, journal content, allergies, or secrets in manifests, logs, analytics, or artifacts.
