import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_MANIFEST_PATH,
  ACTIVE_STATUS_PATH,
  ARCHIVED_MANIFEST_PATHS,
  isActiveManifestPath,
  isArchivedManifestPath,
} from "../scripts/active-manifest.mjs";

/**
 * v24 WS-A.7 — there is exactly ONE canonical active release-manifest path, and
 * every active RC consumer uses it. Before v24, freeze/promote/workflow/renderer
 * disagreed: the active record was v22 but the tooling hard-coded the archived v16
 * manifest. This contract test fails if any active consumer points back at v16, or
 * if the consumers disagree with `scripts/active-manifest.mjs`.
 *
 * Historical v16 tests may still read the v16 manifest — but only as an ARCHIVED
 * snapshot, never as the active line, which this test pins.
 */

const read = (p: string) => readFileSync(p, "utf8");
const V16 = "docs/release/manifest.v16.json";

describe("the canonical active-manifest path is v22 and v16 is archived", () => {
  it("names the v22 manifest as active and the v22 status as its rendered page", () => {
    expect(ACTIVE_MANIFEST_PATH).toBe("docs/release/manifest.v22.json");
    expect(ACTIVE_STATUS_PATH).toBe("docs/release/v22/STATUS.md");
    expect(isActiveManifestPath(ACTIVE_MANIFEST_PATH)).toBe(true);
    // Windows-path spelling must still resolve as the active path.
    expect(isActiveManifestPath("docs\\release\\manifest.v22.json")).toBe(true);
  });

  it("classifies v16 as archived, never active", () => {
    expect(ARCHIVED_MANIFEST_PATHS).toContain(V16);
    expect(isActiveManifestPath(V16)).toBe(false);
    expect(isArchivedManifestPath(V16)).toBe(true);
  });
});

describe("every active RC consumer uses the canonical active path (not v16)", () => {
  it("freeze-candidate imports the canonical path and hard-codes no v16 active default", () => {
    const src = read("scripts/freeze-candidate.mjs");
    expect(src).toContain('from "./active-manifest.mjs"');
    expect(src).toContain("ACTIVE_MANIFEST_PATH");
    expect(src).not.toContain(V16);
  });

  it("promote-candidate imports the canonical path and hard-codes no v16 active default", () => {
    const src = read("scripts/promote-candidate.mjs");
    expect(src).toContain('from "./active-manifest.mjs"');
    expect(src).toContain("ACTIVE_MANIFEST_PATH");
    expect(src).not.toContain(V16);
  });

  it("the release-candidate workflow render-checks and uploads the v22 line, never v16", () => {
    const yaml = read(".github/workflows/release-candidate.yml");
    expect(yaml).toContain("render-release-status.mjs docs/release/manifest.v22.json --check");
    expect(yaml).toContain("docs/release/manifest.v22.json");
    expect(yaml).toContain("docs/release/v22/STATUS.md");
    // No v16 manifest/status may remain as an active workflow reference.
    expect(yaml).not.toContain(V16);
    expect(yaml).not.toContain("docs/release/v16/STATUS.md");
  });

  it("the render-release-status npm script renders the active v22 manifest", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["render-release-status"]).toContain("docs/release/manifest.v22.json");
    expect(pkg.scripts["render-release-status"]).not.toContain(V16);
  });

  it("README pins the active line to v22 (v16 stays linked only as archived history)", () => {
    const readme = read("README.md");
    expect(readme).toContain(ACTIVE_MANIFEST_PATH);
    expect(readme).toContain(ACTIVE_STATUS_PATH);
    // v16 may still appear, but only under an archived/superseded heading.
    expect(readme).toMatch(/archived[^\n]*\n[\s\S]*manifest\.v16\.json/i);
  });
});
