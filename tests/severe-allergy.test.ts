import { describe, it, expect } from "vitest";
import {
  detectSevereAllergySignal,
  normalizeAllergies,
  findMealAllergenViolations,
  SEVERE_ALLERGY_MESSAGE,
} from "@/lib/safety/allergens";
import { severeAllergyBlock } from "@/lib/safety/severe-allergy";
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
