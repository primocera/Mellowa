# Dependency audit — MW-V17-08

Recorded against branch `v17` at the MW-V17-06 commit `6fc1738` (freeze SHA is
cut later in MW-V17-10; this evidence is regenerated at the frozen SHA).

## Production advisory closed

The high advisory ran through `next → postcss@8.5.25 → nanoid@3.3.16`
(nanoid: custom generators can loop indefinitely when size is zero). Patched in
nanoid ≥ 3.3.17.

Minimal fix: one `overrides` entry — `"nanoid": "^3.3.17"` — alongside the
existing `postcss`/`sharp` overrides. `npm install` regenerated `package-lock.json`
(integrity hashes untouched by hand). No Next/PostCSS major/minor change and no
unrelated lockfile churn.

| Check | Before | After |
|---|---|---|
| `npm audit --omit=dev` high | 1 | **0** |
| shipped `nanoid` (`npm ls nanoid`) | 3.3.16 | **3.3.18** |
| `npm run build` | 73 pages | 73 pages (`✓ Compiled successfully`) |
| `npm ci` from clean lockfile | ok | ok |
| unit/contract/safety/eval | 1538 pass | 1538 pass |

`npm audit --omit=dev` → **found 0 vulnerabilities**. `npm explain nanoid` shows the
single shipped instance resolved to 3.3.18.

## Reviewed dev-only exception (NOT a hidden ignore)

`npm audit` (including dev deps) still reports one high: **`js-yaml`** — quadratic
CPU on `!!omap` resolution (CVE-2026-59870), fix not backported to 3.x/4.x. It is:

- **dev-only** — not attributable to the nanoid chain and never in the production
  bundle (`npm audit --omit=dev` is clean);
- **unpatchable today** — no fixed version is published, so `audit fix` cannot
  resolve it and a forced upgrade is refused (policy: no `audit fix --force`, no
  blind Next upgrade).

Policy: this dev-only advisory does **not** gate the production release. It is
tracked here in the open (not suppressed) and re-checked each release; it becomes
a blocker only if a patched js-yaml ships or it enters the production graph.
