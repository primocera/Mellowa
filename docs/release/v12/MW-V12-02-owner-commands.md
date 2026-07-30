# MW-V12-02 — owner execution commands (authenticated matrix)

Claude Code finished the harness, the canonical matrix, the integrity test and
the release runner. It **cannot** produce the authenticated evidence, because
that needs a seeded non-production Supabase project. This is the exact,
copy-pasteable owner procedure. **Do not point any of this at production.**

## What is already done (no env needed)

- Canonical matrix: `e2e/support/matrix.ts` — every required user state and
  journey in one place.
- Integrity gate: `tests/e2e-matrix-integrity.test.ts` — fails the unit build if
  the matrix, the seed script and the specs drift apart (a renamed test, a
  removed fixture, a typo'd skip guard). Runs in `npm run test`.
- Release runner: `scripts/run-auth-matrix.mjs` (`npm run test:e2e:matrix`) —
  seeds every fixture, runs the specs across all three viewports, tracks each
  required journey by title, and **blocks in RC mode** if any never ran.
- New fixtures: `active` (converted paid) and `sample-used` (free sample
  consumed), plus new journeys: sign-out, session-expiry, sample-used gate,
  active-no-trial-banner.

## 1 · Stand up a non-production Supabase project (free tier: 2 per org)

Apply the migration set to it, then create the marker table the seed script
checks. Run this **against the non-production project only**:

```sql
create table if not exists public.e2e_seed_marker (
  id boolean primary key default true,
  note text not null,
  created_at timestamptz not null default now(),
  constraint e2e_seed_marker_single check (id)
);
insert into public.e2e_seed_marker (id, note)
values (true, 'This database may be seeded and wiped. It is NOT production.')
on conflict (id) do nothing;
```

## 2 · Point `.env.local` at it and enable the suite

```
NEXT_PUBLIC_SUPABASE_URL=<non-prod project url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<non-prod anon key>
SUPABASE_SERVICE_ROLE_KEY=<non-prod service role key>
E2E_SUPABASE_TEST=1
E2E_TEST_EMAIL=test@mellowa.local
E2E_TEST_PASSWORD=Mellowa123!
E2E_REQUIRE_SEED_MARKER=1
```

`E2E_REQUIRE_SEED_MARKER=1` makes the seed script **refuse** any database
without the marker table from step 1 — the guard that proves it is not
production. The runner sets it too, so it is belt-and-braces.

## 3 · Build and run the matrix

```
npm run build          # the runner starts the production server via playwright
RC_GATE=1 npm run test:e2e:matrix
```

This seeds each fixture, runs `journeys.spec.ts` once per gated state and
`daily-journey.spec.ts` (self-seeded), across desktop / 375px / 320px. It writes
SHA-pinned evidence to `docs/release/evidence/v12/auth-matrix/<sha>.json` and
exits non-zero if any required journey never passed.

## 4 · What blocks the candidate (do not convert to a pass)

- Any required journey that never ran → `neverPassed` in the evidence, exit 1.
- Any real failure → exit 1.
- A missing environment under `RC_GATE=1` → BLOCKED, exit 1.

Record the evidence path and the exit status in the manifest's
`P1-AUTH-E2E-AT-HEAD` blocker. The `planned` journeys in the matrix
(signup/onboarding/checkout-return/free-sample-create/low-capacity/adjust/
weekly-carry-forward/provider-error) still need authoring against this env and
remain open — they are enumerated so they cannot be forgotten, not claimed as
covered.
