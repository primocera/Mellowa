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

  it("frames the shopping list as a reviewable draft with allergen label-checking", () => {
    expect(weeklyView).toContain("shopping draft");
    expect(weeklyView).toMatch(/quantities come from the planned meals/i);
    expect(weeklyView).toMatch(/check your pantry/i);
    expect(weeklyView).toContain("check product labels for your allergies");
  });

  it("MW-05: weekly plan is a flexible draft with trial-neutral Premium copy", () => {
    expect(weeklyView).toContain("A flexible draft, not a schedule");
    expect(weeklyView).not.toMatch(/start 3 days free/i);
    expect(weeklyView).toMatch(/fair-use limit/i);
  });

  it("MW-05: meal challenges use neutral planning language and a boundary note", () => {
    const mealViewSrc = mealView;
    expect(mealViewSrc).toContain("Evening hunger is hard to plan");
    expect(mealViewSrc).not.toMatch(/overeat|binge|junk food|bad food/i);
    expect(mealViewSrc).toMatch(/not condition-specific\s*nutrition/i);
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

describe("MW-V9-07 weekly loop is one coherent story", () => {
  const todayPage = readFileSync("src/app/(app)/today/page.tsx", "utf8");
  const weekPage = readFileSync("src/app/(app)/weekly-plan/page.tsx", "utf8");
  const reflection = readFileSync(
    "src/components/dailyflow/weekly-reflection.tsx",
    "utf8"
  );

  it("Today no longer renders the weekly recap that competed with Now", () => {
    expect(todayPage).not.toContain("WeeklyRecapCard");
    expect(todayPage).not.toContain("summarizeWeek");
    // Only a quiet contextual link to Week remains.
    expect(todayPage).toContain("Review your week");
    expect(todayPage).toContain('href="/weekly-plan"');
  });

  it("Week is built around This week / Carry forward / Next week", () => {
    expect(weekPage).toContain("This week");
    expect(weekPage).toContain("Carry forward");
    expect(weekPage).toContain("Next week");
    // The recorded summary lives here now.
    expect(weekPage).toContain("WeeklyRecapCard");
    expect(weekPage).toContain("summarizeWeek");
  });

  it("sparse weeks show no fabricated insight — recap card is gated on recorded data", () => {
    expect(weekPage).toContain("hasRecordedWeek");
    expect(reflection).toMatch(/nothing to catch on|nothing to catch up on/i);
    expect(reflection).toContain("Review plan preferences");
  });

  it("carry-forward and recorded facts are not duplicated within Week", () => {
    // The reflection card no longer re-lists the recorded facts (This week owns them).
    expect(reflection).not.toContain("Only what you recorded");
  });

  it("next week shows applied inputs and never auto-generates", () => {
    expect(weeklyView).toContain("What next week will use");
    expect(weeklyView).toContain("carryForwardEffects");
    // Reflection preview never triggers an AI call.
    expect(reflection).not.toMatch(/fetch\("\/api\/ai\//);
  });
});
