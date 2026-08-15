import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-V18-07: active scope/addendum prose may not contradict the machine-readable
 * release truth. The manifest keeps the two owner-gated items OPEN (one accepted,
 * one auto-run at freeze); no scope note may quietly reclassify them as "closed",
 * and every open blocker must actually be addressed by the active note.
 *
 * This extends the release-manifest/status drift tests (which cover the manifest
 * and its rendered STATUS.md) to the prose scope note that sits alongside them.
 */

const manifest = JSON.parse(readFileSync("docs/release/manifest.v16.json", "utf8"));
const scopeNote = readFileSync("PROMPT_PACK_SCOPE_NOTE.md", "utf8");

const openBlockerIds: string[] = (manifest.blockers ?? []).map((b: { id: string }) => b.id);

/** Split into paragraphs (blank-line separated), lowercased for scanning. */
function paragraphs(md: string): string[] {
  return md
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
}
const NEGATIONS = ["not", "never", "n't", "isn't", "aren't", "no longer", "rather than"];

describe("manifest keeps the owner-gated items honest", () => {
  it("keeps P0-LIVE open, records P1 as closed, and never double-lists a blocker", () => {
    expect(openBlockerIds).toContain("P0-LIVE-TRANSACTION");
    const closedIds: string[] = (manifest.closedBlockers ?? []).map(
      (b: { id: string }) => b.id
    );
    // P1 closed once the authenticated matrix was re-observed at the candidate SHA.
    expect(closedIds).toContain("P1-AUTH-E2E-AT-HEAD");
    expect(openBlockerIds).not.toContain("P1-AUTH-E2E-AT-HEAD");
    for (const id of openBlockerIds) {
      expect(closedIds, `${id} is both open and closed`).not.toContain(id);
    }
  });

  it("no launch tier is reported GO while blockers are open", () => {
    for (const [tier, verdict] of Object.entries(manifest.verdicts ?? {})) {
      // A bare "GO" (not "NO-GO", not "CONDITIONAL GO") is forbidden here.
      expect(/^GO$/i.test(String(verdict)), `${tier} must not be a bare GO`).toBe(false);
    }
  });
});

describe("active scope note cannot contradict the manifest", () => {
  it("names the manifest as the authority, not itself", () => {
    expect(scopeNote).toMatch(/manifest\.v16\.json/);
  });

  it("addresses every currently-open blocker", () => {
    for (const id of openBlockerIds) {
      expect(scopeNote, `scope note never mentions open blocker ${id}`).toContain(id);
    }
  });

  it("never positively claims an open blocker is closed", () => {
    const paras = paragraphs(scopeNote);
    for (const id of openBlockerIds) {
      const lid = id.toLowerCase();
      for (const p of paras) {
        if (!p.includes(lid)) continue;
        if (p.includes("closed")) {
          // "closed" may appear ONLY when negated (e.g. "never closed").
          const negated = NEGATIONS.some((n) => p.includes(n));
          expect(
            negated,
            `paragraph mentions ${id} and "closed" without a negation: "${p.slice(0, 160)}…"`
          ).toBe(true);
        }
      }
    }
  });

  it("keeps the evidence-class vocabulary (accepted/open/observed), not a flat 'closed'", () => {
    expect(scopeNote.toLowerCase()).toMatch(/accepted/);
    expect(scopeNote.toLowerCase()).toMatch(/\bopen\b/);
  });
});

describe("supply-chain hardening is real (MW-V18-07)", () => {
  const workflows = [
    ".github/workflows/ci.yml",
    ".github/workflows/release-candidate.yml",
  ].map((f) => ({ f, src: readFileSync(f, "utf8") }));

  it("pins every action to a 40-hex commit SHA, never a floating tag", () => {
    for (const { f, src } of workflows) {
      for (const m of src.matchAll(/uses:\s*([^\s]+)/g)) {
        const ref = m[1];
        expect(ref, `${f}: "${ref}" is not SHA-pinned`).toMatch(/@[0-9a-f]{40}\b/);
      }
    }
  });

  it("declares least-privilege permissions in both workflows", () => {
    for (const { f, src } of workflows) {
      expect(src, `${f} missing permissions block`).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    }
  });

  it("has a Dependabot policy for actions and npm", () => {
    const db = readFileSync(".github/dependabot.yml", "utf8");
    expect(db).toMatch(/package-ecosystem:\s*github-actions/);
    expect(db).toMatch(/package-ecosystem:\s*npm/);
  });
});
