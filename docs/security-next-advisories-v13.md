# MW-P0-03 — Next.js production dependency advisories (v13)

Candidate branch: `launch/v13` (base `74080e0`). Date checked: 2026-08-03.

## Change

- `next`: **16.2.10 → 16.2.12** (same supported line; no major migration).
- `eslint-config-next`: **16.2.10 → 16.2.12** (kept in lockstep with `next`).
- Added `overrides` to pull the transitive libraries that Next still bundles up
  to their patched releases without a forced major:
  - `sharp`: `0.34.5 → ^0.35.3` (fixes libvips CVE-2026-33327/33328/35590/35591).
  - `postcss`: `8.4.31 / 8.5.17 → ^8.5.25` (fixes GHSA-qx2v-qp2m-jg93,
    GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849).
- Lockfile regenerated with `npm install` (the repo package manager). **No**
  `npm audit fix --force` was used. A plain `npm audit fix` cleared a dev-only
  `brace-expansion` DoS advisory in the eslint toolchain (never shipped).

## Audited advisories — resolution

| Advisory | Area | Status after 16.2.12 |
| --- | --- | --- |
| GHSA-6gpp-xcg3-4w24 (proxy bypass) | Next proxy | Resolved |
| GHSA-m99w-x7hq-7vfj (DoS) | Next | Resolved |
| GHSA-89xv-2m56-2m9x (SSRF via rewrites) | Next | Resolved |
| GHSA-4c39-4ccg-62r3 (unbounded Server Action payload, Edge) | Next | Resolved |
| GHSA-p9j2-gv94-2wf4 (SSRF in rewrites) | Next | Resolved |
| GHSA-q8wf-6r8g-63ch (Image Optimization DoS via SVG) | Next | Resolved |
| GHSA-955p-x3mx-jcvp (Server Function endpoint disclosure) | Next | Resolved |
| sharp/libvips CVEs | transitive | Resolved via override → 0.35.3 |
| postcss path-traversal / XSS / info-disclosure | transitive | Resolved via override → 8.5.25 |

## Result

- `npm audit --omit=dev`: **0 vulnerabilities** (production).
- `npm audit` (incl. dev): **0 vulnerabilities**.

No high/critical production advisory remains, so this prompt is not a release
blocker on the dependency axis. `sharp` and `postcss` are pinned by `overrides`;
when a future `next` patch bundles these patched versions natively, the overrides
can be dropped — until then they are the mechanism that keeps the tree clean.

## Defense in depth (proxy is not the only gate)

`src/proxy.ts` redirects unauthenticated users away from `PROTECTED_PREFIXES`,
but the `(app)` layout (`src/app/(app)/layout.tsx`) independently calls
`requireUser()` on every render, which redirects to `/login` server-side even if
the proxy is bypassed. `tests/protected-route-auth.test.ts` proves this directly,
without relying on proxy middleware.

## Reachability of the transitive advisories (for the record)

- **postcss**: exercised at build time processing the project's own CSS; not an
  attacker-reachable runtime path. Patched regardless.
- **sharp**: reached by Next Image Optimization. No `images.remotePatterns` is
  configured, so remote-image optimization (the SVG/libvips vector) is disabled
  by default; local optimization only. Patched regardless.

## Gates (launch/v13, base 74080e0 + this change)

| Gate | Result |
| --- | --- |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `npm run lint` | PASS — 0 errors (2 pre-existing warnings) |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 1255/1255 |
| `npm run eval` | PASS — 81/81 (from P0-01/02 run; unaffected) |
| `npm run build` | PASS |
| `npm run test:e2e:public` | PASS — 75/75 |
| Authenticated E2E matrix | NOT RUN — owner seeded non-prod prereqs (MW-P1-05) |

---

## v18 re-check (MW-V18-07)

**Date checked: 2026-08-14. Review-by: 2026-11-14** (or sooner if Dependabot
opens an advisory PR). This section supersedes the counts above; the v13 record
is retained for history.

- `next` line: **16.2.12** (unchanged; the overrides from the v13 change remain
  in `package.json`).
- Production dependency audit — freshly run, not a carried-over screenshot:

  | Gate | Result (2026-08-14) |
  | --- | --- |
  | `npm audit --omit=dev` | PASS — **0 vulnerabilities** |

- **GitHub Actions supply chain:** every `uses:` in `.github/workflows/*` is now
  pinned to an immutable commit SHA (a floating `@v4` tag can be re-pointed):
  - `actions/checkout` → `11bd71901bbe5b1630ceea73d27597364c9af683` (v4.2.2)
  - `actions/setup-node` → `39370e3970a6d050c480ffad4ff0ed4d3fdee5af` (v4.1.0)
  - `actions/upload-artifact` → `b4b15b8c7c6ac21ea08fcf65892d2ee8f75cf882` (v4.4.3)
- **Update policy:** `.github/dependabot.yml` tracks the `github-actions` and
  `npm` ecosystems weekly, so the SHA pins move forward under review instead of
  going stale, and npm advisories arrive as PRs rather than only via a manual
  audit.
- **Least privilege:** both workflows declare `permissions: contents: read`
  (previously only `release-candidate.yml` did). The RC workflow uploads only
  sanitized evidence and prints variable names, never secret values.

This is current evidence with an explicit review date; it is not a standing
"closed forever" claim — re-run `npm audit --omit=dev` and re-confirm the pins at
the review-by date or on the next Dependabot PR.
