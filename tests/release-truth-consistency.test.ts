import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReleaseManifest } from "@/lib/release/manifest";

/**
 * MW-P0-04: the machine-readable manifest is the single source of release
 * truth. `tests/release-manifest.test.ts` proves the manifest is internally
 * consistent; THIS file proves the human documents (README, v12 STATUS,
 * BUILD_STATE) cannot silently drift away from it.
 *
 * Every assertion derives its expected value from the manifest, so a
 * deliberately introduced contradiction — a blocker relabelled "closed", a
 * candidate SHA typo, a stale test count, a "migrations not applied" line after
 * they were applied — fails CI instead of living quietly in prose.
 *
 * The contradiction classes below are the exact ones the v12 record actually
 * grew: money moved vs no money moved, migration applied vs not, blocked vs
 * closed, candidate SHA mismatch, and stale counts.
 */

const MANIFEST_PATH = "docs/release/manifest.v11.json";
const README = "README.md";
const STATUS = "docs/release/v12/STATUS.md";
const BUILD_STATE = "docs/BUILD_STATE.md";

const manifest = (): ReleaseManifest =>
  JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as ReleaseManifest;
const read = (p: string) => readFileSync(p, "utf8");
const shortSha = (sha: string) => sha.slice(0, 7);

describe("accepted risk is never presented as closed", () => {
  it("every accepted risk still maps to an OPEN blocker, never a closed one", () => {
    const m = manifest();
    const open = new Set(m.blockers.map((b) => b.id));
    const closed = new Set((m.closedBlockers ?? []).map((b) => b.id));
    for (const r of m.acceptedRisks ?? []) {
      expect(open, `${r.blockerId} is accepted but not in open blockers`).toContain(
        r.blockerId
      );
      expect(closed, `${r.blockerId} is accepted AND closed — invalid`).not.toContain(
        r.blockerId
      );
    }
  });

  it("no human doc calls an accepted-risk / open blocker 'closed'", () => {
    const m = manifest();
    const acceptedIds = new Set((m.acceptedRisks ?? []).map((r) => r.blockerId));
    for (const path of [README, STATUS, BUILD_STATE]) {
      const text = read(path);
      for (const line of text.split("\n")) {
        for (const id of acceptedIds) {
          // Match "closed" as a resolution word, not the compound "fail-closed".
          if (line.includes(id) && /(?<!-)\bclosed\b/i.test(line) && !/not closed/i.test(line)) {
            throw new Error(
              `${path}: line mentions accepted-risk blocker ${id} as "closed":\n  ${line.trim()}`
            );
          }
        }
      }
    }
  });
});

describe("candidate SHA agrees with the manifest", () => {
  it("the frozen STATUS pins the manifest rcSha", () => {
    const m = manifest();
    expect(m.rcSha).toBeTruthy();
    expect(read(STATUS)).toContain(m.rcSha!); // STATUS pins the full SHA
  });

  it("README defers to the generated status and hard-codes no candidate SHA/verdict (MW-V17-09)", () => {
    // README no longer duplicates volatile release facts; it links to the
    // machine-generated status. So it must reference the current generated
    // status + manifest and must not claim the loop is closed or read a GO.
    const r = read(README);
    expect(r).toContain("docs/release/v16/STATUS.md");
    expect(r).toContain("docs/release/manifest.v16.json");
    expect(r).not.toMatch(/release loop is closed/i);
    // No stale prior candidate SHA presented as current.
    expect(r).not.toMatch(shortSha("745b4a4b" + "0".repeat(32)));
  });
});

describe("migration-applied status agrees with the manifest", () => {
  it("when the manifest records 040/041 applied, no doc lists them as pending to apply", () => {
    const m = manifest();
    const mig = m.ownerEvidence.find((e) => e.id === "migrations-applied");
    expect(mig).toBeTruthy();
    const applied =
      /040\/041 applied|040 and 041 were applied|applied to the live project/i.test(
        `${mig!.evidence ?? ""} ${mig!.note ?? ""}`
      );
    expect(applied, "manifest should record 040/041 as applied").toBe(true);
    for (const path of [README, STATUS]) {
      const text = read(path);
      // The pending-action phrasing that contradicts an applied state.
      expect(text, `${path} still asks to apply 040/041`).not.toMatch(
        /apply\s+\*\*migrations 040 and 041\*\*/i
      );
      expect(text, `${path} still says 040/041 NOT YET APPLIED`).not.toMatch(
        /040[^.]*not yet applied/i
      );
    }
  });
});

describe("money-moved claims agree with the manifest", () => {
  it("the live-transaction record shows charge+refund live, and no doc claims 'no charge/refund'", () => {
    const m = manifest();
    const live = m.ownerEvidence.find((e) => e.id === "live-transaction");
    expect(live?.note ?? "").toMatch(/refund/i);
    // README must not simultaneously assert nothing was charged/refunded.
    expect(read(README)).not.toMatch(/no charge captured or refunded/i);
  });
});

describe("narrative test counts do not go stale (MW-V17-09)", () => {
  it("README hard-codes no unit/eval test count in its release section — counts live only in the generated status", () => {
    // The failure mode this prevents is a number bumped in one place and not the
    // other. The cure is to have exactly one place: the machine status. The
    // README release section must therefore carry no raw test count.
    const r = read(README);
    const releaseSection = r.slice(
      r.indexOf("## Release status"),
      r.indexOf("## Project state"),
    );
    expect(releaseSection).not.toMatch(/\b\d{3,4}\s*(unit|contract|safety|eval|tests)\b/i);
    expect(releaseSection).not.toMatch(/\b(unit|contract|safety|eval)[^.]*\b\d{3,4}\b/i);
  });
});
