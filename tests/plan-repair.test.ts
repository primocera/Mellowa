import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  replaceableScope,
  repairOutputSchema,
  buildRepairUpdates,
  REPAIR_REASONS,
  type RepairPlanRow,
} from "@/lib/plan/repair";
import type { MealCardType } from "@/schemas/ai-output-v2";

/** MW-S02: atomic remaining-day repair — scope, schema and merge contracts. */

const meal = (meal_type: MealCardType["meal_type"], title: string): MealCardType => ({
  meal_type,
  title,
  short_description: "",
  prep_time_minutes: 5,
  cook_time_minutes: 5,
  total_time_minutes: 10,
  difficulty: "easy",
  budget_level: "low",
  servings: 1,
  ingredients: [{ name: "oats", amount: "50 g", optional: false }],
  preparation_steps: ["Mix", "Eat"],
  approximate_macros: { calories: 300, protein_g: 10, carbs_g: 40, fat_g: 8 },
  why_it_fits_today: "",
  low_energy_swap: "",
  grocery_items: [],
  safety_note: "Macros are approximate and not medical nutrition advice.",
});

const plan: RepairPlanRow = {
  meal_cards: [meal("breakfast", "Oat bowl"), meal("lunch", "Grain salad"), meal("dinner", "Soup")],
  movement_plan: { title: "Walk", duration_minutes: 10 },
  breathing_exercise: { name: "Box", duration_minutes: 3, steps: ["In", "Out"] },
  evening_routine: { steps: ["Lights down"] },
  habit_focus: { habit: "Water", minimum_version: "One glass" },
};

describe("replaceableScope", () => {
  it("excludes completed and explicitly kept items", () => {
    const scope = replaceableScope(plan, ["meal:breakfast", "movement"], ["habit"]);
    expect(scope.mealTypes).toEqual(["lunch", "dinner"]);
    expect(scope.sections).toContain("breathing_exercise");
    expect(scope.sections).toContain("evening_routine");
    expect(scope.sections).not.toContain("movement_plan");
    expect(scope.sections).not.toContain("habit_focus");
  });

  it("absent sections are never in scope", () => {
    const scope = replaceableScope({ meal_cards: [meal("lunch", "Wrap")] }, []);
    expect(scope.sections).toEqual([]);
    expect(scope.mealTypes).toEqual(["lunch"]);
  });

  it("everything protected yields an empty scope (nothing to adjust)", () => {
    const scope = replaceableScope(
      plan,
      ["meal:breakfast", "meal:lunch", "meal:dinner", "movement", "breathing", "evening", "habit"],
      []
    );
    expect(scope.mealTypes).toEqual([]);
    expect(scope.sections).toEqual([]);
  });
});

describe("repairOutputSchema", () => {
  const scope = replaceableScope(plan, ["meal:breakfast", "movement"], []);
  const schema = repairOutputSchema(scope);

  it("accepts exactly the in-scope sections plus a summary", () => {
    const parsed = schema.safeParse({
      repair_summary: "Lighter lunch and dinner; shorter evening.",
      meal_cards: [meal("lunch", "Toast"), meal("dinner", "Eggs")],
      breathing_exercise: { name: "Slow", duration_minutes: 2, steps: ["In", "Out"] },
      evening_routine: { steps: ["Phone away"] },
      habit_focus: { habit: "Water", minimum_version: "Sip" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects extra keys — the AI cannot touch protected sections", () => {
    const parsed = schema.safeParse({
      repair_summary: "x",
      meal_cards: [meal("lunch", "Toast"), meal("dinner", "Eggs")],
      breathing_exercise: { name: "Slow", duration_minutes: 2, steps: ["In", "Out"] },
      evening_routine: { steps: ["Phone away"] },
      habit_focus: { habit: "Water", minimum_version: "Sip" },
      movement_plan: { title: "Sneaky run" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects wrong meal coverage (missing or off-scope meal types)", () => {
    expect(
      schema.safeParse({
        repair_summary: "x",
        meal_cards: [meal("lunch", "Toast"), meal("breakfast", "Nope")],
        breathing_exercise: { name: "Slow", duration_minutes: 2, steps: ["In", "Out"] },
        evening_routine: { steps: ["Phone away"] },
        habit_focus: { habit: "Water", minimum_version: "Sip" },
      }).success
    ).toBe(false);
  });

  it("rejects malformed JSON shapes entirely — nothing partial can commit", () => {
    expect(schema.safeParse({ repair_summary: "only a summary" }).success).toBe(false);
    expect(schema.safeParse("not an object").success).toBe(false);
  });
});

describe("buildRepairUpdates", () => {
  it("keeps protected meals reference-identical (byte-for-byte on serialize)", () => {
    const scope = replaceableScope(plan, ["meal:breakfast"], ["meal:dinner"]);
    const replacementLunch = meal("lunch", "Simple wrap");
    const { updates } = buildRepairUpdates(plan, scope, {
      repair_summary: "s",
      meal_cards: [replacementLunch],
    });
    const cards = updates.meal_cards as MealCardType[];
    expect(cards[0]).toBe(plan.meal_cards![0]); // completed breakfast: same object
    expect(cards[2]).toBe(plan.meal_cards![2]); // kept dinner: same object
    expect(cards[1]).toBe(replacementLunch);
    expect(JSON.stringify(cards[0])).toBe(JSON.stringify(plan.meal_cards![0]));
  });

  it("only in-scope sections appear in updates; changed types are categorical", () => {
    const scope = replaceableScope(plan, [], ["habit", "evening"]);
    const { updates, changedTypes } = buildRepairUpdates(plan, scope, {
      repair_summary: "s",
      meal_cards: [meal("breakfast", "A"), meal("lunch", "B"), meal("dinner", "C")],
      movement_plan: { title: "Stretch" },
      breathing_exercise: { name: "Slow" },
    });
    expect(Object.keys(updates).sort()).toEqual(
      ["breathing_exercise", "meal_cards", "movement_plan"].sort()
    );
    expect(changedTypes.sort()).toEqual(["calm", "meals", "movement"].sort());
    for (const t of changedTypes) {
      expect(t).toMatch(/^[a-z]+$/); // never content, only category labels
    }
  });
});

describe("MW-S02 route + component contract", () => {
  const route = readFileSync("src/app/api/ai/plan-repair/route.ts", "utf8");
  const component = readFileSync("src/components/dailyflow/today-plan-v2.tsx", "utf8");
  const migration = readFileSync(
    "supabase/migrations/027_mellowa_v8_plan_repair.sql",
    "utf8"
  );

  it("classifies safety before generation and blocks without upsell", () => {
    const safetyIdx = route.indexOf("checkInputSafety(user.id");
    const genIdx = route.indexOf("generateStructuredJson({");
    expect(safetyIdx).toBeGreaterThan(-1);
    expect(safetyIdx).toBeLessThan(genIdx);
    const blockedSection = route.slice(safetyIdx, route.indexOf("plan_completions"));
    expect(blockedSection).not.toMatch(/premium|upgrade|trial/i);
  });

  it("uses an idempotency key and the atomic apply RPC", () => {
    expect(route).toContain("x-idempotency-key");
    expect(route).toContain("apply_plan_repair");
    expect(route).toContain("undo_plan_repair");
  });

  it("completed items are protected from the server's own rows", () => {
    expect(route).toContain('from("plan_completions")');
    expect(route).toContain("replaceableScope");
  });

  it("failure copy is honest: plan unchanged, retry offered", () => {
    expect(route).toMatch(/today's plan is unchanged/i);
  });

  it("never logs or emails the raw repair note", () => {
    // The note is only used in the prompt + safety check; analytics carry
    // categorical properties only.
    expect(route).not.toMatch(/console\.[a-z]+\([^)]*user_note/);
    expect(route).not.toMatch(/trackEvent\([^)]*user_note/);
  });

  it("migration snapshots + updates in one function and RLS-protects versions", () => {
    expect(migration).toContain("daily_plan_versions");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("for update");
  });

  it("the UI offers preview with kept items, fair-use disclosure and free Undo", () => {
    expect(component).toContain("Adjust the rest of today");
    expect(component).toContain("Keep as is");
    expect(component).toMatch(/Uses one plan generation from your fair-use allowance/);
    expect(component).toContain("Undo — bring the previous plan back");
    expect(component).toMatch(/not saved or remembered/i);
    // The old multi-request simplify loop is gone.
    expect(component).not.toContain("simplifyDay");
  });

  it("repair reasons are the bounded set", () => {
    expect(REPAIR_REASONS).toEqual([
      "less_time",
      "lower_energy",
      "context_changed",
      "meal_not_working",
      "calmer_version",
    ]);
  });
});
