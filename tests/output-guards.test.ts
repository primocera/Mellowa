import { describe, expect, it } from "vitest";
import {
  checkWeeklyPlanOutput,
  checkMealRhythmOutput,
  checkHabitPlanOutput,
  checkLowEnergyDayOutput,
  checkJournalReflectionOutput,
  checkRegeneratedMealOutput,
  correctiveInstruction,
} from "@/lib/ai/output-guards";
import { sumUsage } from "@/lib/ai/usage";
import type {
  WeeklyPlanOutputType,
  MealRhythmOutputType,
  HabitPlanOutputType,
  JournalReflectionOutputType,
} from "@/schemas/ai-output";
import type { LowEnergyDayOutputType } from "@/schemas/low-energy-day";
import { safeFixturePlan } from "@/lib/evals/corpus";

/** Route-specific output gates (Launch v6, Prompt 13) — one fixture per rejection reason. */

function weeklyPlan(overrides?: Partial<WeeklyPlanOutputType>): WeeklyPlanOutputType {
  return {
    weekly_focus: "One steady meal rhythm",
    meal_structure: {
      title: "Simple week",
      days: [
        { day: "Monday", breakfast: "Oat bowl", lunch: "Rice and vegetables", dinner: "Potato soup", snack: "" },
      ] as never,
      notes: "",
    },
    shopping_list: { title: "List", items: [{ item: "oats", category: "pantry" }] as never },
    movement_plan: { title: "Walks", items: ["Two short walks"] } as never,
    stress_reset_plan: { title: "Resets", items: ["One quiet pause"] } as never,
    habit_plan: { title: "Habit", focus_habit: "Water in the morning", minimum_version: "One sip", tips: [] },
    low_energy_backup_plan: { title: "Backup", items: ["Toast counts"] } as never,
    weekly_review_questions: ["What worked?"],
    ...overrides,
  };
}

describe("weekly plan gate", () => {
  it("passes a clean plan", () => {
    expect(checkWeeklyPlanOutput(weeklyPlan(), []).ok).toBe(true);
  });
  it("rejects diet-culture language", () => {
    const r = checkWeeklyPlanOutput(weeklyPlan({ weekly_focus: "Burn fat with 1200 kcal days" }), []);
    expect(r.ok).toBe(false);
  });
  it("rejects allergens in the meal structure and shopping list", () => {
    const p = weeklyPlan();
    p.shopping_list.items = [{ item: "peanut butter", category: "pantry" }] as never;
    const r = checkWeeklyPlanOutput(p, ["peanuts"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((x) => x.startsWith("allergen:"))).toBe(true);
  });
  it("rejects an empty focus habit", () => {
    const p = weeklyPlan();
    p.habit_plan.focus_habit = " ";
    expect(checkWeeklyPlanOutput(p, []).ok).toBe(false);
  });
});

describe("meal rhythm gate", () => {
  const ideas: MealRhythmOutputType = {
    title: "Easy rhythm",
    ideas: [{ meal_type: "lunch", title: "Rice bowl", description: "", prep_time: "10 min" }],
    notes: "",
  };
  it("passes clean ideas", () => {
    expect(checkMealRhythmOutput(ideas, ["dairy"]).ok).toBe(true);
  });
  it("rejects allergen mentions", () => {
    const bad = { ...ideas, ideas: [{ ...ideas.ideas[0], title: "Cheese omelette" }] };
    expect(checkMealRhythmOutput(bad, ["dairy"]).ok).toBe(false);
  });
});

describe("habit plan gate", () => {
  const plan: HabitPlanOutputType = {
    title: "Small habits",
    habits: [{ name: "Evening tidy", category: "home", frequency: "daily", minimum_version: "One item", why_it_helps: "" }],
  };
  it("passes clean habits", () => expect(checkHabitPlanOutput(plan).ok).toBe(true));
  it("rejects a missing minimum version", () => {
    const bad = { ...plan, habits: [{ ...plan.habits[0], minimum_version: "" }] };
    expect(checkHabitPlanOutput(bad).ok).toBe(false);
  });
  it("rejects shame language", () => {
    const bad = { ...plan, habits: [{ ...plan.habits[0], why_it_helps: "No excuses, push through the pain" }] };
    expect(checkHabitPlanOutput(bad).ok).toBe(false);
  });
});

function lowEnergyDay(): LowEnergyDayOutputType {
  return {
    title: "A softer day",
    message: "Today can be small.",
    minimum_day_plan: [
      { title: "Eat something", detail: "" },
      { title: "Drink water", detail: "" },
    ] as never,
    easy_meals: [{ title: "Toast with butter", detail: "" }] as never,
    one_reset: { title: "Window pause", steps: ["Look outside for a minute."], duration: "1 min" },
    one_tiny_habit: { habit: "Open the curtains", minimum_version: "Just one" },
    evening_recovery: ["Lights down early"],
    encouragement: "Small counts.",
    safety_note: "",
  };
}

describe("low-energy day gate", () => {
  it("passes a clean plan", () => {
    expect(checkLowEnergyDayOutput(lowEnergyDay(), []).ok).toBe(true);
  });
  it("rejects allergens in easy meals", () => {
    const p = lowEnergyDay();
    p.easy_meals = [{ title: "Peanut butter toast", detail: "" }] as never;
    expect(checkLowEnergyDayOutput(p, ["peanuts"]).ok).toBe(false);
  });
  it("rejects restrictive-eating language", () => {
    const p = lowEnergyDay();
    p.message = "Just skip meals today.";
    expect(checkLowEnergyDayOutput(p, []).ok).toBe(false);
  });
});

describe("journal reflection gate", () => {
  const ok: JournalReflectionOutputType = {
    reflection: "You noticed the mornings felt easier when the evening was quieter.",
    gentle_question: "What made the quieter evening possible?",
    one_small_action: "Set the kettle up before bed tonight.",
  };
  it("passes a clean reflection", () => expect(checkJournalReflectionOutput(ok).ok).toBe(true));
  it("rejects certainty about emotional state", () => {
    expect(checkJournalReflectionOutput({ ...ok, reflection: "You are clearly depressed." }).ok).toBe(false);
  });
  it("rejects clinical interpretation", () => {
    expect(checkJournalReflectionOutput({ ...ok, reflection: "This sounds like burnout." }).ok).toBe(false);
  });
  it("rejects crisis counselling (belongs to the safety flow)", () => {
    expect(checkJournalReflectionOutput({ ...ok, one_small_action: "Call the crisis line." }).ok).toBe(false);
  });
  it("rejects clinical referral language", () => {
    expect(checkJournalReflectionOutput({ ...ok, gentle_question: "You should see a therapist?" }).ok).toBe(false);
  });
});

describe("regenerated meal gate", () => {
  it("passes a clean meal card", () => {
    expect(checkRegeneratedMealOutput(safeFixturePlan().meal_cards[0]).ok).toBe(true);
  });
  it("rejects a missing safety note and too few steps", () => {
    const meal = { ...safeFixturePlan().meal_cards[0], safety_note: "", preparation_steps: ["One step"] };
    const r = checkRegeneratedMealOutput(meal);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("helpers", () => {
  it("corrective instruction names the failure reasons", () => {
    expect(correctiveInstruction(["allergen:dairy"])).toContain("allergen:dairy");
  });
  it("sumUsage adds tokens and latency across attempts", () => {
    const u = (i: number) => ({ provider: "anthropic", model: "m", inputTokens: i, outputTokens: i * 2, latencyMs: 100, status: "success" as const });
    const summed = sumUsage([u(100), undefined, u(50)], "quality_failed")!;
    expect(summed.inputTokens).toBe(150);
    expect(summed.outputTokens).toBe(300);
    expect(summed.latencyMs).toBe(200);
    expect(summed.status).toBe("quality_failed");
    expect(sumUsage([undefined], "success")).toBeUndefined();
  });
});
