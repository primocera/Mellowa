import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildWeeklyPlanUserPrompt, WEEKLY_PLAN_SYSTEM_PROMPT } from "@/prompts/weekly-plan";

/**
 * MW-S05: meal continuity — favourites/leftovers/pantry feed weekly planning
 * as normalized data only, and the loop never turns into a diet product.
 */

const baseArgs = {
  profile: { food_preferences: ["vegetarian"] },
  recentCheckins: [],
  habits: [],
  notes: "",
  weekStart: "2026-07-20",
};

describe("weekly prompt meal continuity", () => {
  it("passes only normalized favourite metadata (title, type, ingredient names)", () => {
    const prompt = buildWeeklyPlanUserPrompt({
      ...baseArgs,
      mealContinuity: {
        favourites: [
          { title: "Chickpea bowl", meal_type: "lunch", ingredients: ["chickpeas", "rice"] },
        ],
        repeatLeftovers: false,
        varietyLevel: null,
        pantryItems: [],
      },
    });
    expect(prompt).toContain("SAVED FAVOURITE MEALS");
    expect(prompt).toContain("Chickpea bowl");
    expect(prompt).toContain("(saved favourite)");
  });

  it("labels leftovers and keeps pantry items off the shopping list", () => {
    const prompt = buildWeeklyPlanUserPrompt({
      ...baseArgs,
      mealContinuity: {
        favourites: [],
        repeatLeftovers: true,
        varietyLevel: "keep_it_similar",
        pantryItems: ["rice", "olive oil"],
      },
    });
    expect(prompt).toContain("(leftovers)");
    expect(prompt).toMatch(/do NOT add them to the shopping list/);
    expect(prompt).toContain("repetition is welcome, not a flaw");
  });

  it("adds no continuity block when nothing is configured", () => {
    const prompt = buildWeeklyPlanUserPrompt({
      ...baseArgs,
      mealContinuity: {
        favourites: [],
        repeatLeftovers: false,
        varietyLevel: null,
        pantryItems: [],
      },
    });
    expect(prompt).not.toContain("MEAL CONTINUITY");
  });

  it("frames continuity as practical reuse, never a diet or target", () => {
    const prompt = buildWeeklyPlanUserPrompt({
      ...baseArgs,
      mealContinuity: {
        favourites: [{ title: "Soup", meal_type: "dinner", ingredients: [] }],
        repeatLeftovers: false,
        varietyLevel: null,
        pantryItems: [],
      },
    });
    expect(prompt).toContain("never a diet or nutrition target");
    expect(prompt).not.toMatch(/calorie|deficit|weight loss/i);
    expect(WEEKLY_PLAN_SYSTEM_PROMPT).toMatch(/Do not create strict diets/);
  });
});

describe("MW-S05 route contracts", () => {
  const weekly = readFileSync("src/app/api/ai/weekly-plan/route.ts", "utf8");
  const shopping = readFileSync("src/app/api/shopping/build/route.ts", "utf8");

  it("favourites are allergen-validated before they can reach the prompt", () => {
    const favIdx = weekly.indexOf("favourite_meals");
    const gateIdx = weekly.indexOf("findMealAllergenViolations", favIdx);
    const genIdx = weekly.indexOf("generateWeeklyPlan({");
    expect(favIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(favIdx);
    expect(gateIdx).toBeLessThan(genIdx);
  });

  it("user-entered pantry text goes through the safety classifier", () => {
    expect(weekly).toMatch(/pantryItems\.join\(", "\)/);
    expect(weekly).toContain("checkInputSafety");
  });

  it("saved meal notes never reach the weekly prompt", () => {
    // Only title/meal_type/ingredient names are extracted from favourites.
    const meta = weekly.slice(
      weekly.indexOf("favouritesMeta.push"),
      weekly.indexOf("favouritesMeta = favouritesMeta.slice")
    );
    expect(meta).not.toMatch(/note|description|why_it_fits/);
  });

  it("shopping draft skips pantry items visibly, never silently", () => {
    expect(shopping).toContain("pantry_items");
    expect(shopping).toContain("on_hand");
    expect(shopping).toMatch(/never silently dropped/i);
  });

  it("shopping draft still re-validates allergens per favourite", () => {
    expect(shopping).toContain("findMealAllergenViolations");
    expect(shopping).toContain("excluded_meals");
  });
});

describe("MW-S05 surface copy", () => {
  const weekView = readFileSync("src/components/dailyflow/weekly-plan-view.tsx", "utf8");
  const favView = readFileSync("src/components/dailyflow/favourites-view.tsx", "utf8");
  const prefs = readFileSync("src/components/dailyflow/plan-preferences-form.tsx", "utf8");

  it("weekly view explains the labels and keeps everything swappable", () => {
    expect(weekView).toContain("(saved favourite)");
    expect(weekView).toContain("(leftovers)");
    expect(weekView).toMatch(/Everything\s+is swappable/);
  });

  it("pantry exclusions are shown with a no-completeness disclaimer", () => {
    expect(favView).toContain("usually on hand");
    expect(favView).toMatch(/never assume/i);
  });

  it("preferences frame continuity as practical reuse, not dieting", () => {
    expect(prefs).toContain("Meal continuity");
    expect(prefs).toMatch(/never a diet/i);
    expect(prefs).not.toMatch(/calorie|macro target|weight/i);
  });
});
