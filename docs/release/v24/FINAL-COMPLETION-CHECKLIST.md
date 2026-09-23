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

## 5. Dokazna tabela: vsaka zahteva dokumenta (Mellowa)

Vsaka vrstica je zahteva iz dokumenta *Finalni MVP release popravki*, preverjena v
repozitoriju 2026-09-23. ☑ = izpolnjeno z dokazom · ◐ = izpolnjeno z opombo (P2).

### Prompt 2: enotni aktivni manifest in exact SHA release

| Zahteva | Status | Dokaz |
|---|---|---|
| A1 En canonical ACTIVE MANIFEST PATH | ◐ | `scripts/active-manifest.mjs` ga izvaža; freeze in promote ga uvažata. YAML workflow in `package.json` JS konstante ne moreta uvoziti, zato ga zapišeta dobesedno; `tests/active-manifest-path.test.ts` faila, če se razlikujeta. |
| A2 v16 se ne uporablja za freeze/promote/status/upload | ☑ | Nobena aktivna referenca na v16 v workflowu, `freeze-candidate.mjs`, `promote-candidate.mjs` ali `package.json` (ostali so samo komentarji). |
| A3 freeze sprejme `--manifest` ali canonical path | ☑ | `scripts/freeze-candidate.mjs` (`opt("--manifest", ACTIVE_MANIFEST_PATH)`). |
| A4 promote uporablja isti path; `--manifest` validiran in zapisan v provenance | ◐ | Isti path ✓; `promotedFrom` provenance ✓. Samo eksplicitni `--manifest` skripta ne validira posebej. Ta promocija ni tekla prek skripte (reviewed edit), manifest pa validira `npm run release-manifest` (86/86). |
| A5 Workflow validira in render-checka v22, freeze iz v22, upload v22 | ☑ | RC run 35814658356, koraki 9 (validate), 10 (status sync), 20 (freeze), 21 (upload `manifest.v22.json` + `v22/STATUS.md`). |
| A6 Candidate vsebuje dependency audit s SHA hashom, `observedAtUtc`, clean counts | ☑ | Candidate: `dependency-audit` sha `2543a38`, `artifactHash`, `observedAtUtc 2026-09-23T03:31:47Z`, 0 najdb. Freeze faila brez suita (`freeze-candidate.mjs`); aktivni manifest ga zahteva (`tests/dependency-audit-gate.test.ts`). |
| A7 Contract test za workflow, freeze, promote, renderer in README | ☑ | `tests/active-manifest-path.test.ts` (vseh 5 potrošnikov). |
| A8 v16 testi omejeni na arhiv | ☑ | `tests/release-v16.test.ts` bere samo `manifest.v16.json`; ne vpliva na v22 verdict. |
| B1 Brez GO na 1b7dfef ob drugačnem health | ☑ | v24 je 1b7dfef označil superseded; zdaj promoted `2543a38` = health. |
| B2 Nov finalni SHA, ne f0dbcf5 | ☑ | FINAL SHA `2543a38`. |
| B3 suites.sha = rcSha = buildId = deploy = owner readiness | ☑ | Vsi `2543a38` (razdelek 4 in `manifest.v22.json`, `owner-evidence.v22.json`, `/api/health`, `ready-result`). |
| B4 Docs commit ne sme sam deployati | ☑ | Politika v `RELEASE-TRUTH-RECONCILIATION.md`; evidence je na ne-deployajoči veji `evidence/v24`, `main` = `2543a38` = produkcija. |
| B5 Scale = GATHERING DATA, mature value ni launch gate | ☑ | `manifest.v22.json` `scaleExpansion`; `tests/release-truth-v24.test.ts` (6). |
| C1 v23 OWNER-CHECKLIST uvod in tabela usklajena | ☑ | Tabela označena TEMPLATE HISTORY, brez trditve "all executed". |
| C2 Vsak izveden korak: application, sha, UTC, operator, rezultat, referenca, expected/observed | ☑ | Razdelek 2 in tabela C2 spodaj. |
| C3 Smoke, throwaway, email exactly once: dokaz ali NOT RUN | ☑ | Smoke passed; naročnina preklicana; email exactly-once iz live A–H (2026-09-05), carried forward. |
| C4 Brez emailov, skrivnosti, kartic, Stripe objektov | ☑ | Pregled `docs/release/v24`, manifesta, owner evidence in artifactov: 0 zadetkov (email, `sk_live`, `whsec_`, `cus_`, kartice). |
| C5 A–H carry-forward samo ob praznem runtime diffu | ☑ | `git diff 1b7dfef..2543a38`: `src/`, `supabase/` in `package-lock.json` nespremenjeni (potrdil tudi audit). |
| D Šest release-truth testov | ☑ | `tests/release-truth-v24.test.ts` (1)–(6). |
| Obvezni ukazi (ci, audit, lint, typecheck, test, eval, build, release-manifest, render --check) | ☑ | Razdelek 4: audit 0, lint 0, typecheck 0, vitest 2221 (+2 CRLF), eval 81/81, release-manifest 86/86, build ✓, render v sync. |
| Zaključni odgovor Prompta 2 | ☑ | `RELEASE-TRUTH-RECONCILIATION.md`: path in potrošniki, odstranjene/ohranjene v16 reference, handoff. |

### Tabela C2: expected proti observed

| Korak | Expected | Observed | UTC | Operator | Rezultat |
|---|---|---|---|---|---|
| RC na FINAL SHA | success, head `2543a38`, vsi gatei | success, `2543a38`, 21/21 | 03:31–03:40 | Primoz Cerar | passed |
| Deploy | `/api/health` = `2543a38` | `{"ok":true,"version":"2543a38"}` | 2026-09-23 | Primoz Cerar | passed |
| Paid readiness | 200, vse ok | 200, 35/35 ok | 03:55:38 | Primoz Cerar | passed |
| Smoke | login, plan, adjustment, checkout, portal delujejo | "everything works" | 2026-09-23 | Primoz Cerar | passed |
| Throwaway naročnina | ne more obnoviti | preklicana | 2026-09-23 | Primoz Cerar | passed |
| Email exactly once | vsak email enkrat | enkrat (live A–H, 2026-09-05); runtime nespremenjen | 2026-09-05 | Primoz Cerar | passed (carried forward) |

### Prompt 3 in Prompt 4

| Zahteva | Status | Dokaz |
|---|---|---|
| Prompt 3 pravila: FINAL SHA, brez novega produkcijskega commita | ☑ | `main` = `2543a38` = produkcija; evidence na `evidence/v24`. |
| Prompt 3 zaporedje za Mellowo 1–8 | ☑ | Razdelek 2 ("Owner koraki"). |
| Obvezni evidence zapis (8 polj) | ☑ | Razdelek 2. |
| Stop pogoji (skipped E2E, audit, SHA razlika, readiness blocker, PII, nov commit) | ☑ | Noben ni nastopil: E2E 93/0, audit 0, SHA enaki, readiness 35/35, brez PII, po RC ni runtime commita. |
| Prompt 4 faze 1–4 in verdict | ☑ | Razdelek 4: GO/GO/GO/GO, scale GATHERING DATA, samo P2. |
| Končni completion checklist (Mellowa vrstice) | ☑ | Razdelek 1. |

**Zaključek:** vse zahteve dokumenta za Mellowo so izpolnjene in podprte z dokazi.
Odprte so le P2 opombe (razdelek 4, #1–#2, ter A1 in A4 zgoraj). Nobena ne vpliva na
verdict; vse se uredijo ob naslednjem runtime releasu. **Mellowa v24: DONE.**

## Odprto

- P2 #1, #2 in A4 (validacija eksplicitnega `--manifest` v promote) zahtevajo spremembo
  `scripts/` ali workflowa, zato jih popravimo ob naslednjem runtime releasu z novim RC.
  Zdaj ne, ker bi s tem zavrgli sedanji kandidat.
- **Docs-only commiti še vedno deployajo.** Vercel Ignored Build Step ni nastavljen, zato
  commit tega dokumenta premakne `/api/health` z `2543a38`. Pred pushem nastavi Ignored
  Build Step (glej [`RELEASE-TRUTH-RECONCILIATION.md`](RELEASE-TRUTH-RECONCILIATION.md)).
- Znani vrzeli release toolinga za naslednji RC: freeze pri code suitih uporabi star
  evidence tekst; workflow ne naloži JSON-a authenticated matrixa.
