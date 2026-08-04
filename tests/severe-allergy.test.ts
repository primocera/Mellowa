import { describe, it, expect } from "vitest";
import {
  detectSevereAllergySignal,
  normalizeAllergies,
  findMealAllergenViolations,
  SEVERE_ALLERGY_MESSAGE,
} from "@/lib/safety/allergens";
import {
  severeAllergyBlock,
  isSevereAllergy,
  stripMealsForSevereAllergy,
} from "@/lib/safety/severe-allergy";
import type { MealCardType } from "@/schemas/ai-output-v2";

describe("severe allergy detection (Prompt 8)", () => {
  it("detects severe/life-threatening signals in free text", () => {
    for (const text of [
      "peanuts (anaphylaxis)",
      "nuts - I carry an epipen",
      "severe allergy to shellfish",
      "life-threatening dairy allergy",
    ]) {
      expect(detectSevereAllergySignal([text]), text).toBe(true);
    }
  });

  it("does not flag ordinary allergy phrasing", () => {
    for (const text of ["lactose", "nuts", "gluten intolerance", "mild soy allergy"]) {
      expect(detectSevereAllergySignal([text]), text).toBe(false);
    }
  });

  it("blocks meal generation via the profile flag or text signal", () => {
    expect(
      severeAllergyBlock({ allergies: ["nuts"], allergies_severe: true })
    ).toEqual({ blocked: true, user_message: SEVERE_ALLERGY_MESSAGE });
    expect(
      severeAllergyBlock({ allergies: ["peanut anaphylaxis"], allergies_severe: false })
    ).not.toBeNull();
    expect(
      severeAllergyBlock({ allergies: ["lactose"], allergies_severe: false })
    ).toBeNull();
  });

  it("boundary message recommends professional guidance, no meal advice", () => {
    expect(SEVERE_ALLERGY_MESSAGE).toMatch(/dietitian|specialist/i);
    expect(SEVERE_ALLERGY_MESSAGE).not.toMatch(/we suggest .*meal/i);
  });

  it("isSevereAllergy mirrors the flag and the text signal", () => {
    expect(isSevereAllergy({ allergies: ["nuts"], allergies_severe: true })).toBe(true);
    expect(
      isSevereAllergy({ allergies: ["peanut anaphylaxis"], allergies_severe: false })
    ).toBe(true);
    expect(isSevereAllergy({ allergies: ["lactose"], allergies_severe: false })).toBe(false);
    expect(isSevereAllergy({ allergies: null, allergies_severe: null })).toBe(false);
  });
});

describe("severe-allergy daily plan (meals stripped, rest kept)", () => {
  it("empties meal_cards and appends the boundary message to the safety note", () => {
    const plan = {
      meal_cards: [{ title: "Peanut stew" }, { title: "Cashew salad" }],
      safety_note: "Move gently today.",
      movement_moment: { name: "A short walk" },
      encouragement: "You're doing enough.",
    };
    const out = stripMealsForSevereAllergy(plan);
    expect(out.meal_cards).toEqual([]);
    expect(out.safety_note).toBe(`Move gently today. ${SEVERE_ALLERGY_MESSAGE}`);
    // Non-meal sections are untouched — this is the whole point of the change.
    expect(out.movement_moment).toEqual({ name: "A short walk" });
    expect(out.encouragement).toBe("You're doing enough.");
  });

  it("sets the boundary message even when there was no prior safety note", () => {
    const out = stripMealsForSevereAllergy({ meal_cards: [{}], safety_note: null });
    expect(out.meal_cards).toEqual([]);
    expect(out.safety_note).toBe(SEVERE_ALLERGY_MESSAGE);
  });
});

describe("unrecognized allergy terms (Prompt 8)", () => {
  it("flags unknown terms for user confirmation, still matched literally", () => {
    const { categories, customTerms } = normalizeAllergies(["lupin", "milk"]);
    expect(categories).toContain("dairy");
    expect(customTerms).toContain("lupin");

    const meal = {
      meal_type: "lunch",
      title: "Lupin flour flatbread",
      short_description: "",
      prep_time_minutes: 5,
      cook_time_minutes: 5,
      total_time_minutes: 10,
      difficulty: "easy",
      budget_level: "low",
      servings: 1,
      ingredients: [{ name: "lupin flour", amount: "1 cup", optional: false }],
      preparation_steps: ["Mix.", "Bake."],
      approximate_macros: {
        calories: 300,
        protein_g: 5,
        carbs_g: 60,
        fat_g: 3,
        fiber_g: 2,
      },
      why_it_fits_today: "",
      low_energy_swap: "",
      grocery_items: ["lupin flour"],
      safety_note: "",
    } as MealCardType;
    const violations = findMealAllergenViolations(meal, ["lupin"]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].category).toBe("custom:lupin");
  });
});
