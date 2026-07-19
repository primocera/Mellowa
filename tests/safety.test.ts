import { readFileSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  normalizeAllergies,
  findMealAllergenViolations,
} from "@/lib/safety/allergens";
import { preClassifySafety } from "@/lib/safety/pre-classify";
import type { MealCardType } from "@/schemas/ai-output-v2";

const meal = (over: Partial<MealCardType>): MealCardType => ({
  meal_type: "lunch",
  title: "Test bowl",
  short_description: "",
  prep_time_minutes: 5,
  cook_time_minutes: 5,
  total_time_minutes: 10,
  difficulty: "easy",
  budget_level: "low",
  servings: 1,
  ingredients: [{ name: "rice", amount: "1 cup", optional: false }],
  preparation_steps: ["Cook rice.", "Serve."],
  approximate_macros: { calories: 300, protein_g: 5, carbs_g: 60, fat_g: 3, fiber_g: 2 },
  why_it_fits_today: "",
  low_energy_swap: "",
  grocery_items: [],
  safety_note: "Macros are approximate and not medical nutrition advice.",
  ...over,
});

describe("allergen validation (P5)", () => {
  it("maps user terms to canonical categories", () => {
    const n = normalizeAllergies(["lactose", "Peanuts", "cow's milk allergy"]);
    expect(n.categories).toContain("dairy");
    expect(n.categories).toContain("peanut");
  });

  it("flags dairy derivatives in ingredients", () => {
    const v = findMealAllergenViolations(
      meal({ ingredients: [{ name: "whey protein", amount: "1 scoop", optional: false }] }),
      ["dairy"]
    );
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].category).toBe("dairy");
  });

  it("passes a clean meal", () => {
    expect(findMealAllergenViolations(meal({}), ["peanut", "shellfish"])).toEqual([]);
  });

  it("matches custom terms literally", () => {
    const v = findMealAllergenViolations(
      meal({ ingredients: [{ name: "fresh kiwi", amount: "1", optional: false }] }),
      ["kiwi"]
    );
    expect(v[0]?.category).toBe("custom:kiwi");
  });
});

describe("safety pre-classifier (P17)", () => {
  it("blocks clear self-harm language with crisis level", () => {
    const r = preClassifySafety("I want to kill myself", "en-US");
    expect(r?.should_block_generation).toBe(true);
    expect(r?.risk_level).toBe("crisis");
    expect(r?.user_message).toContain("988");
  });

  it("uses regional helpline from locale", () => {
    const r = preClassifySafety("thinking about suicide", "en-GB");
    expect(r?.user_message).toContain("116 123");
  });

  it("blocks eating-disorder behaviour", () => {
    const r = preClassifySafety("I make myself throw up after eating");
    expect(r?.risk_types).toContain("eating_disorder");
  });

  it("does NOT block ordinary tired/stressed phrasing", () => {
    expect(preClassifySafety("I'm dying to sleep, this week is killing me")).toBeNull();
    expect(preClassifySafety("low energy, stressful day at work")).toBeNull();
  });
});

describe("MW-04: safety gate is wired into every AI generation route", () => {
  it("every generation route classifies input before generating", () => {
    const routes = readdirSync("src/app/api/ai").filter(
      (r: string) => r !== "safety-check"
    );
    for (const route of routes) {
      const src = readFileSync(`src/app/api/ai/${route}/route.ts`, "utf8");
      expect(
        /checkInputSafety|preClassifySafety/.test(src),
        `AI route "${route}" must call the safety gate before generation`
      ).toBe(true);
    }
  });

  it("the daily-plan route has no v1 generator import (one source of truth)", () => {
    const src = readFileSync("src/app/api/ai/daily-plan/route.ts", "utf8");
    expect(src).toContain("generate-daily-plan-v2");
    expect(src).not.toMatch(/generate-daily-plan"/);
  });
});
