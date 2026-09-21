import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReleaseManifest } from "@/lib/release/manifest";
import {
  SUPPORT_SLA_GUARANTEED,
  SUPPORT_REPLY_COPY,
  SUPPORT_NOT_MONITORED_COPY,
} from "@/lib/support/policy";

/**
 * MW-V17-09: the active docs cannot contradict the machine truth.
 *
 * README/status/audit claims are machine-derived, and customer-facing support
 * timing matches an operationally owned commitment (or is best-effort). A stale
 * "release loop closed", a hard-coded verdict, a "0 vulnerabilities" claim that
 * could drift, or a guaranteed SLA with no operation behind it fails here.
 */

const read = (p: string) => readFileSync(p, "utf8");
const v22 = (): ReleaseManifest =>
  JSON.parse(read("docs/release/manifest.v22.json")) as ReleaseManifest;

describe("README defers to machine-generated release truth", () => {
  const readme = read("README.md");

  it("does not overclaim: the release loop is not narrated as 'closed' in prose", () => {
    // Even with v22 promoted, the README must not restate a hand-written
    // "release loop is closed" narrative — the promoted state lives in the
    // generated v22 STATUS + manifest, not in README prose.
    expect(readme).not.toMatch(/release loop is closed/i);
    expect(readme).not.toMatch(/the path to launch is clean and the release loop/i);
  });

  it("does not hard-code an active GO/CONDITIONAL GO verdict table in the release section", () => {
    // The verdicts live in the generated v22 STATUS page (linked), never as a
    // hand-typed table in README — that is how the two would drift.
    const section = readme.slice(
      readme.indexOf("## Release status"),
      readme.indexOf("## Project state"),
    );
    expect(section).not.toMatch(/\|\s*(CONDITIONAL )?GO\s*\|/);
    // It must point at the generated status rather than restating verdicts.
    expect(section).toContain("docs/release/v22/STATUS.md");
  });

  it("pins the current promoted line to the manifest's frozen RC and links the generated status", () => {
    const m = v22();
    expect(m.rcSha, "test premise: v22 has a frozen RC").toBeTruthy();
    // README references the current promoted line's generated status + manifest.
    expect(readme).toContain("docs/release/v22/STATUS.md");
    expect(readme).toContain("docs/release/manifest.v22.json");
    // Earlier lines stay linked as archived history, not as the current record.
    expect(readme).toContain("docs/release/manifest.v16.json");
    expect(readme).toContain("docs/release/evidence/v17/dependency-audit.md");
  });

  it("makes no standalone current 'zero vulnerabilities' claim that could drift", () => {
    // The dependency posture points at the audit evidence; it must not assert a
    // bare "0 vulnerabilities" as prose in the current section.
    const section = readme.slice(
      readme.indexOf("## Release status"),
      readme.indexOf("## Project state"),
    );
    expect(section).not.toMatch(/0 vulnerabilities/i);
    expect(section).not.toMatch(/zero vulnerabilities/i);
  });

  it("marks earlier release snapshots as archived/not current", () => {
    expect(readme).toMatch(/archived — not current/i);
  });
});

describe("the active certification never claims one owner gate both DONE and unfinished (v23)", () => {
  const cert = read("docs/release/v22/MELLOWA-FINAL-CLOSURE-CERTIFICATION.md");
  const m = v22();

  // Lines that TALK ABOUT the contradiction (the correction note) rather than
  // asserting a status are not themselves a status claim.
  const isMetaCommentary = (line: string) =>
    /previously read|contradiction this release line|corrected here/i.test(line);

  it("no status line marks a gate both DONE/✅ and IN PROGRESS/NOT RUN", () => {
    // The exact v22 defect: §7 called paid readiness "NOT RUN" and the live A–H
    // rehearsal "IN PROGRESS" while §9/§10 and the manifest said DONE.
    for (const line of cert.split("\n")) {
      if (isMetaCommentary(line)) continue;
      const done = /\bDONE\b|✅/.test(line);
      const unfinished = /\bIN PROGRESS\b|\bNOT RUN\b/i.test(line);
      expect(done && unfinished, `contradictory status on one line: ${line.trim()}`).toBe(false);
    }
  });

  it("a gate the manifest records as completed is never still described as IN PROGRESS", () => {
    // Every owner-evidence gate the manifest marks passing must read as done in the
    // active certification — never carried as an unfinished ("IN PROGRESS") claim.
    const passing = new Set(["local_pass", "ci_pass", "preview_pass", "live_rehearsed", "observed"]);
    const live = m.ownerEvidence.find((o) => o.id === "live-transaction");
    expect(live, "test premise: v22 records a live-transaction owner gate").toBeTruthy();
    expect(passing.has(live!.status), "test premise: live transaction is recorded done").toBe(true);
    // The live A–H rehearsal must not appear as IN PROGRESS anywhere in the cert.
    expect(cert).not.toMatch(/A[–-]H[^\n]*\bIN PROGRESS\b/i);
    expect(cert).not.toMatch(/\bIN PROGRESS\b[^\n]*A[–-]H/i);
  });
});

describe("support timing is consistent and not a hollow guarantee", () => {
  const help = read("src/app/(app)/help/page.tsx");
  const settings = read("src/app/(app)/settings/page.tsx");

  it("Help and Settings both render the one shared support-reply copy and the emergency boundary", () => {
    for (const src of [help, settings]) {
      expect(src).toContain("SUPPORT_REPLY_COPY");
      expect(src).toContain("SUPPORT_NOT_MONITORED_COPY");
      // No hard-coded guaranteed-SLA sentence.
      expect(src).not.toMatch(/replies within 2 business days/i);
    }
  });

  it("uses best-effort wording unless a real support operation is declared", () => {
    if (SUPPORT_SLA_GUARANTEED) {
      expect(SUPPORT_REPLY_COPY).toMatch(/within two business days/i);
    } else {
      // Best-effort: 'aim to', never a guarantee.
      expect(SUPPORT_REPLY_COPY).toMatch(/aim to reply/i);
      expect(SUPPORT_REPLY_COPY).not.toMatch(/guarantee/i);
    }
    expect(SUPPORT_NOT_MONITORED_COPY).toMatch(/not monitor/i);
  });
});
