/**
 * The ONE canonical active release-manifest path (v24, Prompt 2 WS-A).
 *
 * Before v24 the RC tooling disagreed with itself: the active release record was
 * `docs/release/manifest.v22.json`, but `freeze-candidate`, `promote-candidate`,
 * the release-candidate workflow's status render-check and its evidence upload all
 * still hard-coded `docs/release/manifest.v16.json`. So a freeze/promote/upload
 * could run against a stale, archived manifest that no longer even has the same
 * required suites (v16 has no `dependency-audit` suite; v22 does).
 *
 * This module is the single source of truth for "which manifest is the active
 * release line". Every Node script, the workflow (indirectly, via the scripts it
 * runs), the renderer default and the contract test import it, so the string lives
 * in exactly one place. Pure ESM (no TS, no filesystem) so it runs under plain
 * `node` in the workflow and imports directly into a Vitest contract test — the
 * same pattern as `candidate-lib.mjs` and `render-release-status.mjs`.
 *
 * Historical manifests remain on disk as immutable ARCHIVED snapshots. They are
 * never used for freeze, promote, the active status check or the active artifact
 * upload; their own historical tests may still read them, clearly scoped as
 * archived (see `tests/release-v16.test.ts`).
 */

/** Normalise a repo-relative path to forward slashes (Windows-safe compares). */
export const normalizeManifestPath = (p) => String(p ?? "").replace(/\\/g, "/");

/** The active release line's canonical manifest path. */
export const ACTIVE_MANIFEST_PATH = "docs/release/manifest.v22.json";

/** The active line's generated status page (rendered from the active manifest). */
export const ACTIVE_STATUS_PATH = "docs/release/v22/STATUS.md";

/**
 * Archived manifests — immutable historical snapshots. NEVER the active line.
 * Kept explicit so the contract test can assert none of them is the active path.
 */
export const ARCHIVED_MANIFEST_PATHS = Object.freeze([
  "docs/release/manifest.v11.json",
  "docs/release/manifest.v13.json",
  "docs/release/manifest.v16.json",
  "docs/release/manifest.v20.json",
]);

/** True iff `p` is the canonical active manifest path (slash-insensitive). */
export const isActiveManifestPath = (p) =>
  normalizeManifestPath(p) === ACTIVE_MANIFEST_PATH;

/** True iff `p` is a known archived (non-active) manifest path. */
export const isArchivedManifestPath = (p) =>
  ARCHIVED_MANIFEST_PATHS.includes(normalizeManifestPath(p));
