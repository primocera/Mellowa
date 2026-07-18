import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Week / meal rhythm / shopping copy regression (Content Elevation v6, Prompt 10).
 * Weekly planning reads as a loose starting shape that supports Today, not a
 * second core product or a schedule to maintain.
 */

const weeklyView = readFileSync(
  "src/components/dailyflow/weekly-plan-view.tsx",
  "utf8"
);
const mealPage = readFileSync("src/app/(app)/meal-rhythm/page.tsx", "utf8");
const mealView = readFileSync(
  "src/components/dailyflow/meal-rhythm-view.tsx",
  "utf8"
);

describe("week & meals copy (CE-10)", () => {
  it("uses the elevated weekly empty state and CTA", () => {
    expect(weeklyView).toContain("Start with the week you actually have");
    expect(weeklyView).toContain("Shape this week");
    expect(weeklyView).not.toContain("No weekly plan yet");
  });

  it("makes shopping editing and allergen label-checking explicit", () => {
    expect(weeklyView).toContain("This list is editable.");
    expect(weeklyView).toContain("check product labels for your allergies");
  });

  it("frames meal rhythm around the user's situation", () => {
    expect(mealPage).toContain("Make regular eating easier");
    expect(mealPage).toContain("Choose the situation Mellowa should plan around.");
    expect(mealView).toContain("Create meal ideas");
  });

  it("uses concrete, non-shaming challenge categories", () => {
    for (const c of [
      "No cooking time",
      "Irregular workday",
      "Low appetite earlier",
      "Busy evenings",
      "Budget matters most",
      "I need variety",
    ]) {
      expect(mealView).toContain(c);
    }
    expect(mealView).not.toContain("Evening overeating");
  });
});
