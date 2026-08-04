import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-07: the project's identity contract. Mellowa is a general-wellbeing
 * adaptive-day app; the old "DailyFlow" product name must not come back in
 * customer-visible copy or in the agent instructions. Labeled migration history
 * and internal lowercase folder paths (src/components/dailyflow/...) are allowed
 * — only the PRODUCT NAME "DailyFlow" (capitalised) is forbidden on live
 * surfaces.
 */

const agents = readFileSync("AGENTS.md", "utf8");

describe("AGENTS.md is the current Mellowa contract", () => {
  it("names Mellowa as the product, not DailyFlow", () => {
    expect(agents).toContain("# Mellowa — Project Rules");
    // The old framing must be gone.
    expect(agents).not.toContain("DailyFlow AI is a consumer wellness");
    expect(agents).not.toContain("## DailyFlow is NOT");
  });

  it("only mentions DailyFlow as labeled history, never as the live product", () => {
    const offenders = agents
      .split("\n")
      .filter((line) => line.includes("DailyFlow"))
      .filter(
        (line) =>
          !/histor|previously|migration/i.test(line),
      );
    expect(
      offenders,
      `DailyFlow used outside a historical/label context: ${offenders.join(" | ")}`,
    ).toEqual([]);
  });

  it("describes the adaptive-day mechanism", () => {
    expect(agents).toMatch(/adaptive-day/i);
    expect(agents).toContain("reshapes what is left");
    expect(agents).toContain("Completed items are kept");
    expect(agents).toMatch(/Undo is free/i);
    expect(agents).toMatch(/Preference learning is visible, editable and removable/i);
  });

  it("preserves the mandatory safety boundaries", () => {
    expect(agents).toContain("Never diagnose");
    expect(agents).toContain("Never provide emergency mental health support");
    for (const notA of ["a medical app", "a therapy app", "an eating disorder recovery tool"]) {
      expect(agents).toContain(notA);
    }
  });

  it("defines the free vs paid truth", () => {
    expect(agents).toContain("one lifetime sample");
    expect(agents).toMatch(/trial begins \*\*only when the user chooses a plan/i);
    expect(agents).toMatch(/fair-use safeguards/i);
  });
});

describe("customer-visible surfaces never show the DailyFlow product name", () => {
  // Case-sensitive: the product name is "DailyFlow"; lowercase "dailyflow"
  // survives only in internal import paths (src/components/dailyflow/...), which
  // are not customer-visible.
  const surfaces = [
    "src/lib/content/terminology.ts",
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/pricing/page.tsx",
    "src/README.md",
  ];

  it.each(surfaces)("%s does not contain the DailyFlow product name", (path) => {
    expect(readFileSync(path, "utf8")).not.toContain("DailyFlow");
  });

  it("the brand and metadata say Mellowa", () => {
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("Mellowa");
    expect(readFileSync("src/lib/content/terminology.ts", "utf8")).toMatch(/Mellowa|wellbeing plan/);
  });
});
