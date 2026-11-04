import { describe, it, expect } from "vitest";
import {
  normalizeAllergies,
  findMealAllergenViolations,
  findAllergenCategoriesInText,
} from "@/lib/safety/allergens";
import type { MealCardType } from "@/schemas/ai-output-v2";

const meal = (title: string, ingredient = "rice"): MealCardType => ({
  meal_type: "lunch",
  title,
  short_description: "",
  prep_time_minutes: 5,
  cook_time_minutes: 5,
  total_time_minutes: 10,
  difficulty: "easy",
  budget_level: "low",
  servings: 1,
  ingredients: [{ name: ingredient, amount: "1", optional: false }],
  preparation_steps: ["Serve."],
  approximate_macros: { calories: 300, protein_g: 5, carbs_g: 60, fat_g: 3, fiber_g: 2 },
  why_it_fits_today: "",
  low_energy_swap: "",
  vegetarian_swap: "",
  dairy_free_swap: "",
  gluten_free_swap: "",
  leftovers_tip: "",
  grocery_items: [],
  safety_note: "",
});

describe("allergen matcher: plurals and derivative foods", () => {
  it.each([
    ["sesame", "Hummus & veggie plate"],
    ["tree nut", "Pesto pasta"],
    ["tree nut", "Toast with Nutella"],
    ["dairy", "Paneer tikka"],
    ["dairy", "Pesto pasta"],
    ["gluten", "Chicken tortillas"],
    ["gluten", "Veggie wraps"],
    ["gluten", "Banana pancakes"],
    ["egg", "Banana pancakes"],
    ["dairy", "Banana pancakes"],
    ["shellfish", "Garlic shrimps"],
    ["fish", "Anchovy toast"],
  ])("%s allergy flags %s", (allergy, title) => {
    expect(findMealAllergenViolations(meal(title), [allergy]).length).toBeGreaterThan(0);
  });

  it("matches plurals in non-meal text too", () => {
    expect(findAllergenCategoriesInText("Two flour tortillas", ["gluten"])).toContain("gluten");
    expect(findAllergenCategoriesInText("A few anchovies", ["fish"])).toContain("fish");
  });

  it("maps plural and species user entries to a category", () => {
    const n = normalizeAllergies(["almonds", "cashews", "shrimps", "salmon", "crab"]);
    expect(n.categories).toEqual(expect.arrayContaining(["tree_nut", "shellfish", "fish"]));
    expect(n.customTerms).toEqual([]);
  });

  it("an 'almonds' allergy flags almond milk", () => {
    const v = findMealAllergenViolations(meal("Overnight oats", "almond milk"), ["almonds"]);
    expect(v[0]?.category).toBe("tree_nut");
  });

  it("seafood covers both fish and shellfish", () => {
    const n = normalizeAllergies(["seafood"]);
    expect(n.categories).toEqual(expect.arrayContaining(["fish", "shellfish"]));
  });

  it("does not match inside other words", () => {
    expect(findMealAllergenViolations(meal("Coconut rice", "coconut"), ["nut"])).toEqual([]);
    expect(findMealAllergenViolations(meal("Sweet potato piece", "potato"), ["gluten"])).toEqual([]);
  });

  it("still passes a clean meal", () => {
    expect(findMealAllergenViolations(meal("Rice bowl"), ["peanut", "sesame", "gluten"])).toEqual([]);
  });
});
