# Mellowa: končni completion checklist in owner rezultat (v24)

Izpolnjeno po dokumentu *Finalni MVP release popravki* (neodvisni audit 22. 9. 2026),
**samo za Mellowo**. Scalvya (repo `primocera/LaunchBloom`) ni predmet tega repozitorija.

**FINAL SHA:** `2543a38a41cb6689b17acc9cc1d96059b785e774` · **Operator:** Primoz Cerar ·
**Datum:** 2026-09-23

## 1. Končni completion checklist

Pravilo iz dokumenta: kljukica brez evidence reference ne šteje.

| Področje | Kriterij | Status | Dokaz |
|---|---|---|---|
| Scalvya active docs | Launch state, certifikat in owner checklist se ne razlikujejo. | N/A | Drug repozitorij (`primocera/LaunchBloom`), ni del Mellowe. |
| Scalvya health version | Javni health pokaže deployed FINAL SHA. | N/A | Drug repozitorij. |
| Scalvya RC | Full RC run na FINAL SHA, authenticated E2E izveden. | N/A | Drug repozitorij. |
| Mellowa active manifest | Freeze, promote, workflow in renderer uporabljajo v22 active path. | ☑ | `scripts/active-manifest.mjs` → `docs/release/manifest.v22.json`. Uvažajo ga `freeze-candidate.mjs`, `promote-candidate.mjs`, `.github/workflows/release-candidate.yml` in render skripta. `tests/active-manifest-path.test.ts` faila ob povratku na v16. |
| Mellowa candidate artifact | Vse required suite, tudi dependency audit, so vezane na FINAL SHA. | ☑ | [`evidence/v17/candidate/2543a38….json`](../evidence/v17/candidate/2543a38a41cb6689b17acc9cc1d96059b785e774.json): vseh 9 required suitov. 8 je `ci_pass` @`2543a38`; `release-check` je zamrznjen kot `blocked` in zapisan ob promociji z owner dokazom. Dependency audit je clean, 0 najdb, `observedAtUtc 2026-09-23T03:31:47Z` ([artifact](../evidence/v23/dependency-audit/2543a38a41cb6689b17acc9cc1d96059b785e774.json)). |
| Mellowa deploy parity | Javni health version je enak RC head SHA. | ☑ | `GET https://mellowa.app/api/health` → `{"ok":true,"version":"2543a38"}` = head sha RC runa [35814658356](https://github.com/primocera/Mellowa/actions/runs/35814658356). |
| Paid readiness | Svež 200 readiness dokaz na deployanem SHA. | ☑ | Avtenticiran `GET /api/health/ready`: **HTTP 200**, `mode: paid`, vse komponente `ok` (tudi `cron_billing_reconcile_freshness`), `version: 2543a38`, 2026-09-23T03:55:38Z (po deployu). |
| Owner evidence | Ni nasprotja DONE proti NOT RUN in ni nedokazane trditve "all steps". | ☑ | `docs/release/v23/OWNER-CHECKLIST.md`: tabela označena TEMPLATE HISTORY, brez trditve "all executed". Dejanski zapis: [`RELEASE-TRUTH-RECONCILIATION.md`](RELEASE-TRUTH-RECONCILIATION.md). Test: `tests/release-truth-v24.test.ts` (4). |
| Security | Production dependency audit je 0. | ☑ | `npm audit --omit=dev` = 0 (lokalno in SHA-pinned artifact v RC runu). |
| MVP scope | Ni novih funkcij ali scale zahtev; scale expansion ostaja ločen. | ☑ | v24 = release tooling, testi in dokumenti. `git diff 1b7dfef..2543a38` ne spremeni nobene runtime poti. Scale expansion = GATHERING DATA. |

## 2. Obvezni evidence zapis (Prompt 3)

| Polje | Vrednost | Rezultat |
|---|---|---|
| application | `mellowa` | passed |
| candidate sha | `2543a38a41cb6689b17acc9cc1d96059b785e774` (40 znakov) | passed |
| workflow run | [35814658356](https://github.com/primocera/Mellowa/actions/runs/35814658356): conclusion **success**, head sha `2543a38`, 2026-09-23T03:31:23Z do 03:40:15Z. Vseh 21 korakov: hard dependency audit, v22 manifest validation, v22 status sync, lint, typecheck, unit/contract/safety, eval, build, public E2E, **authenticated matrix (120 skupaj / 93 passed / 0 failed / 27 skipped)**, run summary, **freeze** | passed |
| deploy identity | `GET /api/health` → `version: 2543a38` | passed |
| observed at utc | RC audit 2026-09-23T03:31:47Z; readiness 2026-09-23T03:55:38Z (po deployu) | passed |
| readiness | HTTP 200, `mode: paid`, 0 blockerjev, vse paid-critical komponente `ok` | passed |
| operator | Primoz Cerar | — |
| result | passed | passed |

### Owner koraki (Zaporedje za Mellowo)

| # | Korak | Rezultat | Dokaz |
|---|---|---|---|
| 1 | RC immutable gate na FINAL SHA | passed | run 35814658356 |
| 2 | Run success, head sha in vsi obvezni gatei | passed | 21/21 korakov zelenih |
| 3 | Candidate in dependency-audit artifact | passed | artifact `rc-evidence-2543a38…`, shranjen v `docs/release/evidence/` |
| 4 | Deploy točno FINAL SHA | passed | `/api/health` = `2543a38` |
| 5 | Paid readiness 200 | passed | 2026-09-23T03:55:38Z, vse `ok` |
| 6 | Smoke: login, plan, adjustment, checkout, portal | passed | owner-attested 2026-09-23 ("everything works") |
| 7 | Throwaway naročnina ne more obnoviti | passed | owner-attested 2026-09-23: naročnina preklicana |
| 7 | Cancellation in payment-recovered email po enkrat | carried forward | Za ta korak ni ponovno potrjeno. Dokaz iz live A–H 2026-09-05 (`docs/release/v22/LIVE-TRANSACTION-EVIDENCE.md`) velja, ker je email-idempotency runtime nespremenjen. |
| 8 | Live A–H carry-forward | passed | `git diff 1b7dfef..2543a38`: billing, webhook, entitlement in email runtime so nespremenjeni |

## 3. Končni verdict

| Track | Verdict | Minimalni dokaz |
|---|---|---|
| Automated code gate | **GO** | Vsi required gatei zeleni v RC runu 35814658356 in lokalno (vitest 2221 pass; 2 znana Windows CRLF faila na zgodovinskih v16/v20 STATUS, zelena na CI). |
| Capped beta | **GO** | Code gate + authenticated matrix na `2543a38` + production readiness 200. |
| Supervised paid MVP | **GO** | Exact deploy `2543a38`, paid readiness 200, billing dokaz (live A–H carried forward). |
| Strict public paid | **GO** | Vse zgoraj; brez odprtih P0/P1 blockerjev (`manifest.v22.json` `blockers: []`, `P0-V24-DEPLOY-PARITY` zaprt). |
| Scale expansion | **GATHERING DATA** | Ni mature cohort poročila; nikoli izmišljeno. |

Verdicti so izpeljani z `deriveVerdicts` (`scripts/candidate-lib.mjs`), ne ročno vpisani;
glej [`STATUS.md`](../v22/STATUS.md).

## 4. Prompt 4: neodvisna read-only certifikacija (2026-09-23)

Izvedena v ločeni Claude Code seji, read-only, v ločenem worktree-ju na `2543a38`.

| Preverjanje | Rezultat |
|---|---|
| origin/main = FINAL SHA | `2543a38a41cb6689b17acc9cc1d96059b785e774` ✓ |
| RC run 35814658356 | `workflow_dispatch` na `main`, head_sha `2543a38`, success, 03:31–03:40 UTC, 21/21 korakov; artifact se ujema z `evidence/v24` ✓ |
| Javni `/api/health` | 200, `version: 2543a38` ✓ |
| `npm audit --omit=dev` | 0 ✓ |
| lint / typecheck | exit 0 / 0 napak ✓ |
| vitest | 2221 pass / 2 fail (release-v16, mw08: Windows CRLF; na CI zelena, korak 13) ✓ |
| eval / release-manifest | 81/81 / 86/86 ✓ |
| build | RC korak 15 success + Vercel deploy; lokalno 78/78 strani (kratka pot) ✓ |
| Odstranjeni ali preimenovani testi | nobeden (+2 datoteki, +14 testov) ✓ |
| Authenticated E2E | ni skipped: 120 / 93 passed / 0 failed / 27 skipped ✓ |
| Release truth | en aktivni manifest; STATUS je byte-exact render; 9/9 required suitov; `blockers: []` ✓ |
| Paid readiness | 200, `mode: paid`, 35/35 komponent ok (03:55 UTC) ✓ |
| Live A–H carry-forward | runtime diff `1b7dfef..2543a38` prazen ✓ |

**Verdict audita:** Automated code gate **GO** · Capped beta **GO** · Supervised paid
MVP **GO** · Strict public paid **GO** · Scale expansion **GATHERING DATA**.

**Najdbe (vse P2, nič blokirajočega):**

| # | Nivo | Najdba | Popravek |
|---|---|---|---|
| 1 | P2 release integrity | JSON authenticated matrixa ni v RC artifactu (ohranjena sta le counts in hash v candidate) | Dodati pot v upload korak workflowa (naslednji RC) |
| 2 | P2 release integrity | Frozen candidate ima pri code suitih star evidence tekst (sha je pravilen; manifest ga popravi) | Freeze naj prepiše evidence s trenutnim runom (naslednji RC) |
| 3 | P2 docs | README odstavek je mešal "resolved" in zgodovinski "UNASSESSED"; owner evidence nima vedno UTC časa in imena | README popravljen 2026-09-23; UTC in operator sta v tem dokumentu (razdelek 2) |

## Odprto

- P2 #1 in #2 zahtevata spremembo `scripts/` ali workflowa, zato ju popravimo ob
  naslednjem runtime releasu z novim RC. Zdaj ne, ker bi s tem zavrgli sedanji kandidat.
- **Docs-only commiti še vedno deployajo.** Vercel Ignored Build Step ni nastavljen, zato
  commit tega dokumenta premakne `/api/health` z `2543a38`. Pred pushem nastavi Ignored
  Build Step (glej [`RELEASE-TRUTH-RECONCILIATION.md`](RELEASE-TRUTH-RECONCILIATION.md)).
- Znani vrzeli release toolinga za naslednji RC: freeze pri code suitih uporabi star
  evidence tekst; workflow ne naloži JSON-a authenticated matrixa.
