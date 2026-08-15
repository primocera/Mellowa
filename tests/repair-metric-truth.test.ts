import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-10: the repair funnel is an atomic commit with a deterministic post-commit
 * diff and free Undo (Path B) — there is NO before-commit preview. No active
 * scorecard/readiness document may name a `plan_repair_previewed` event or a
 * `preview→apply` metric, because neither has an executable source, and the
 * production code never emits such an event.
 */

const ACTIVE_DOCS = [
  "docs/beta-scorecard.md",
  "docs/release/v16/READINESS-SCORE.md",
  "docs/release/v17/COHORT-METRIC-DICTIONARY.md",
];

// The real, emitted repair events (src/lib/analytics/catalog.ts).
const REAL_REPAIR_EVENTS = [
  "plan_repair_requested",
  "plan_repair_completed",
  "plan_repair_undone",
];

describe("no active document names the nonexistent preview event as a metric", () => {
  for (const path of ACTIVE_DOCS) {
    it(`${path} does not use plan_repair_previewed as a live metric`, () => {
      const doc = readFileSync(path, "utf8");
      // A doc may explain that the event does NOT exist; it must not present it
      // as a metric numerator. So a bare "| `plan_repair_previewed` /" table cell
      // is forbidden, and a "preview→apply ≥" threshold is forbidden.
      expect(doc).not.toMatch(/`plan_repair_previewed`\s*\//);
      expect(doc).not.toMatch(/preview\s*→\s*apply\s*≥/i);
    });
  }
});

describe("the production code never emits a preview event", () => {
  it("catalog and repair route have no plan_repair_previewed", () => {
    const catalog = readFileSync("src/lib/analytics/catalog.ts", "utf8");
    const route = readFileSync("src/app/api/ai/plan-repair/route.ts", "utf8");
    expect(catalog).not.toContain("plan_repair_previewed");
    expect(route).not.toContain("plan_repair_previewed");
  });

  it("the real repair events all exist in the analytics catalog", () => {
    const catalog = readFileSync("src/lib/analytics/catalog.ts", "utf8");
    for (const ev of REAL_REPAIR_EVENTS) {
      expect(catalog, `${ev} missing from catalog`).toContain(ev);
    }
  });
});

describe("the active scorecard uses the real repair funnel", () => {
  const scorecard = readFileSync("docs/beta-scorecard.md", "utf8");
  it("names plan_repair_requested → plan_repair_completed and distinct-day repeat", () => {
    expect(scorecard).toContain("plan_repair_requested");
    expect(scorecard).toContain("plan_repair_completed");
    expect(scorecard).toContain("repeat_repair_distinct_day");
    expect(scorecard).toContain("plan_repair_undone");
  });
});
