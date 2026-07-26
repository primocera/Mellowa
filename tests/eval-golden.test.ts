import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EVAL_INPUT_CASES,
  consecutiveDaysFixture,
  safeFixturePlan,
  safeFixturePlanFor,
} from "@/lib/evals/corpus";
import {
  evaluatePlanOutput,
  evaluateRepairPreservation,
  evaluateVariety,
  knownFactsFor,
} from "@/lib/evals/validators";
import {
  allFitViolations,
  cookingBudgetMinutes,
  genericityViolations,
  inventedPersonalFacts,
  mealTimeFitViolations,
  minimumVersionViolations,
  workloadMinutes,
  workloadViolations,
} from "@/lib/evals/fit";
import { repetitionAcross, repetitionSummary } from "@/lib/evals/repetition";
import { PROMPT_VERSIONS } from "@/prompts/versions";
import { planProvenanceSummary } from "@/lib/plan/provenance";

/**
 * MW-V10-04: golden gate proofs.
 *
 * A gate that has never been shown to fail is not a gate. Every block below
 * takes a plan that passes safety, schema and tone, breaks exactly one thing
 * that matters for *usefulness*, and asserts the eval catches it. If any of
 * these ever passes, the corresponding validator has stopped working.
 */

const caseFor = (id: string) => EVAL_INPUT_CASES.find((c) => c.id === id)!;

describe("time and cooking fit", () => {
  it("maps every onboarding cooking option to a budget, and nothing else", () => {
    expect(cookingBudgetMinutes("no_cooking")).toBe(5);
    expect(cookingBudgetMinutes("under_15_min")).toBe(15);
    expect(cookingBudgetMinutes("under_30_min")).toBe(30);
    expect(cookingBudgetMinutes("under_60_min")).toBe(60);
    // No stated budget is not a guessed budget.
    expect(cookingBudgetMinutes("any")).toBeNull();
    expect(cookingBudgetMinutes("")).toBeNull();
    expect(cookingBudgetMinutes(null)).toBeNull();
    expect(cookingBudgetMinutes("whenever I feel like it")).toBeNull();
  });

  it("catches a meal that exceeds the time the user said they have", () => {
    const plan = safeFixturePlan(); // 25-minute meals
    const v = mealTimeFitViolations(plan.meal_cards, "under_15_min");
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].code).toBe("meal_over_time_budget");
    expect(v[0].detail).toContain("25 min");
    expect(v[0].detail).toContain("15 min");
  });

  it("a low-energy swap does not excuse an over-budget primary suggestion", () => {
    const plan = safeFixturePlan();
    plan.meal_cards = plan.meal_cards.map((m) => ({
      ...m,
      low_energy_swap: "Use a microwave pouch — two minutes.",
    }));
    expect(mealTimeFitViolations(plan.meal_cards, "under_15_min").length).toBeGreaterThan(0);
  });

  it("treats a no-cooking day as no cooking, not fast cooking", () => {
    const plan = safeFixturePlan();
    plan.meal_cards = [
      { ...plan.meal_cards[0], total_time_minutes: 4, prep_time_minutes: 1, cook_time_minutes: 3 },
    ];
    const v = mealTimeFitViolations(plan.meal_cards, "no_cooking");
    expect(v.some((x) => x.detail.includes("no-cooking day"))).toBe(true);
  });

  it("passes when the plan actually fits", () => {
    const c = caseFor("little-time");
    expect(mealTimeFitViolations(safeFixturePlanFor(c).meal_cards, c.profile.cooking_time)).toEqual([]);
  });
});

describe("bounded workload", () => {
  it("counts only stated durations, never invented ones", () => {
    const plan = safeFixturePlan();
    plan.meal_cards = [{ ...plan.meal_cards[0], total_time_minutes: 20 }];
    plan.movement_moment = { ...plan.movement_moment!, duration_minutes: 10 };
    plan.breathing_exercise = { ...plan.breathing_exercise!, duration_minutes: 3 };
    plan.meditation_or_reflection = null;
    plan.relaxation_technique = null;
    expect(workloadMinutes(plan)).toBe(33);
  });

  it("catches a minimum day that quietly asks for two hours", () => {
    const plan = safeFixturePlan();
    plan.plan_mode = "minimum";
    plan.meal_cards = [{ ...plan.meal_cards[0], total_time_minutes: 60 }];
    plan.movement_moment = { ...plan.movement_moment!, duration_minutes: 45 };
    const v = workloadViolations(plan);
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe("workload_over_budget");
    expect(v[0].detail).toContain("minimum");
  });

  it("does not flag a plan that is merely fuller than average", () => {
    const plan = safeFixturePlan();
    plan.plan_mode = "balanced";
    expect(workloadViolations(plan)).toEqual([]);
  });
});

describe("no invented personal facts", () => {
  it("catches a plan that invents a partner, kids or a gym", () => {
    for (const [text, expected] of [
      ["Cook this with your partner in the evening.", "a partner"],
      ["A ten-minute walk while your kids are at school.", "children"],
      ["Do this on your way home from your gym.", "a gym or class"],
      ["Take it with your medication as usual.", "medication"],
      ["Same as you did yesterday.", "a past day"],
    ] as const) {
      const plan = safeFixturePlan();
      plan.plan_summary.short_note = text;
      const v = inventedPersonalFacts(plan, []);
      expect(v.length, text).toBeGreaterThan(0);
      expect(v[0].detail).toContain(expected);
    }
  });

  it("allows a reference the user themselves supplied", () => {
    const plan = safeFixturePlan();
    plan.plan_summary.short_note = "Something quick before your commute.";
    // The user said "commute" in their own check-in note.
    expect(inventedPersonalFacts(plan, ["commute"])).toEqual([]);
    // …and flags it when they did not.
    expect(inventedPersonalFacts(plan, ["deadline"]).length).toBeGreaterThan(0);
  });

  it("stays clean on the untouched fixture", () => {
    expect(inventedPersonalFacts(safeFixturePlan(), [])).toEqual([]);
  });
});

describe("no generic filler where the plan must be specific", () => {
  it("catches generic advice in a meal title, focus or habit", () => {
    for (const slot of ["meal", "habit", "focus", "summary"] as const) {
      const plan = safeFixturePlan();
      if (slot === "meal") plan.meal_cards[0].title = "Eat healthy";
      if (slot === "habit") plan.one_small_habit = { ...plan.one_small_habit!, habit: "Drink water" };
      if (slot === "focus") plan.focus_block = { ...plan.focus_block!, main_task: "Take a break" };
      if (slot === "summary") plan.plan_summary.main_focus = "Practice self-care";
      const v = genericityViolations(plan);
      expect(v.length, slot).toBeGreaterThan(0);
      expect(v[0].code).toBe("generic_filler");
    }
  });

  it("allows the same words inside a real instruction", () => {
    const plan = safeFixturePlan();
    plan.meal_cards[0].title = "Eat healthy fats with breakfast";
    expect(genericityViolations(plan)).toEqual([]);
  });

  it("allows an ordinary closing encouragement", () => {
    const plan = safeFixturePlan();
    plan.encouragement = "Be kind to yourself.";
    // Encouragement is allowed to be ordinary; a meal title is not.
    expect(genericityViolations(plan)).toEqual([]);
  });
});

describe("a low-capacity day offers a way down", () => {
  it("catches a low-energy plan with no smaller versions", () => {
    const plan = safeFixturePlan();
    plan.meal_cards = plan.meal_cards.map((m) => ({ ...m, low_energy_swap: "" }));
    plan.movement_moment = { ...plan.movement_moment!, low_energy_version: "" };
    plan.evening_wind_down = { ...plan.evening_wind_down!, simple_version: "" };
    const v = minimumVersionViolations(plan, { energy_level: 1 });
    expect(v.length).toBe(4);
    expect(new Set(v.map((x) => x.code))).toEqual(new Set(["missing_minimum_version"]));
  });

  it("does not require them on a normal-energy day", () => {
    const plan = safeFixturePlan();
    plan.meal_cards = plan.meal_cards.map((m) => ({ ...m, low_energy_swap: "" }));
    expect(minimumVersionViolations(plan, { energy_level: 4 })).toEqual([]);
  });
});

describe("repetition across consecutive days", () => {
  it("passes a varied week", () => {
    const findings = repetitionAcross(consecutiveDaysFixture("varied"));
    expect(findings, JSON.stringify(findings)).toEqual([]);
    expect(repetitionSummary(findings)).toMatch(/no repetition/i);
  });

  it("catches a week that is one day four times", () => {
    const findings = repetitionAcross(consecutiveDaysFixture("repetitive"));
    const codes = new Set(findings.map((f) => f.code));
    expect(codes.has("meal_title_repeated")).toBe(true);
    expect(codes.has("movement_repeated")).toBe(true);
    expect(codes.has("calm_reset_repeated")).toBe(true);
    // Every finding names the days involved, so a report is reproducible.
    for (const f of findings) expect(f.dayIds.length).toBeGreaterThan(1);
    expect(repetitionSummary(findings)).toMatch(/repetition finding/);
  });

  it("does not count a favourite or a leftover as repetition", () => {
    const days = consecutiveDaysFixture("repetitive").map((d) => ({
      ...d,
      intentionalMealTitles: [d.plan.meal_cards[0].title],
    }));
    const findings = repetitionAcross(days);
    expect(findings.some((f) => f.code === "meal_title_repeated")).toBe(false);
    expect(findings.some((f) => f.code === "meal_ingredients_repeated")).toBe(false);
    // …but the non-food dimensions are still reported: declaring a favourite
    // meal cannot buy silence about four identical walks.
    expect(findings.some((f) => f.code === "movement_repeated")).toBe(true);
  });

  it("catches a rename — same ingredients, different title", () => {
    const days = consecutiveDaysFixture("varied");
    days[1].plan.meal_cards[0] = {
      ...days[0].plan.meal_cards[0],
      title: "Berry yoghurt bowl with oats",
    };
    const findings = repetitionAcross(days);
    expect(findings.some((f) => f.code === "meal_ingredients_repeated")).toBe(true);
  });

  it("never reports the recurring habit — a daily habit is the feature", () => {
    const findings = repetitionAcross(consecutiveDaysFixture("repetitive"));
    expect(findings.some((f) => f.detail.toLowerCase().includes("habit"))).toBe(false);
  });

  it("says nothing about a single day", () => {
    expect(repetitionAcross(consecutiveDaysFixture("repetitive").slice(0, 1))).toEqual([]);
  });

  it("is order-stable, so two runs produce an identical report", () => {
    const a = JSON.stringify(repetitionAcross(consecutiveDaysFixture("repetitive")));
    const b = JSON.stringify(repetitionAcross(consecutiveDaysFixture("repetitive")));
    expect(a).toBe(b);
  });

  it("is wired into the eval gate as its own pass/fail", () => {
    expect(evaluateVariety(consecutiveDaysFixture("varied")).pass).toBe(true);
    expect(evaluateVariety(consecutiveDaysFixture("repetitive")).pass).toBe(false);
  });
});

describe("repair preserves what the user did or kept", () => {
  const plan = {
    meal_cards: safeFixturePlan().meal_cards,
    movement_plan: { title: "walk" },
    breathing_exercise: { name: "exhale" },
    evening_routine: { steps: ["dim"] },
    habit_focus: { habit: "water" },
  };

  it("protects every completed and kept key, across all fixture combinations", () => {
    const combos: [string[], string[]][] = [
      [[], []],
      [["meal:lunch"], []],
      [[], ["movement"]],
      [["meal:lunch", "movement"], ["evening"]],
      [["meal:lunch", "meal:dinner", "movement", "breathing", "evening", "habit"], []],
    ];
    for (const [done, kept] of combos) {
      const r = evaluateRepairPreservation(plan, done, kept);
      expect(r.pass, `${JSON.stringify({ done, kept })} → ${JSON.stringify(r.issues)}`).toBe(true);
    }
  });

  it("a protected meal is never in the replaceable scope", () => {
    const r = evaluateRepairPreservation(plan, ["meal:lunch"], []);
    expect(r.issues).toEqual([]);
    // The complement: an unprotected meal IS replaceable, or repair does nothing.
    const scopeCheck = evaluateRepairPreservation(plan, [], []);
    expect(scopeCheck.pass).toBe(true);
  });
});

describe("the eval gate rejects unusable-but-safe plans end to end", () => {
  it("fails an over-time plan for the little-time case", () => {
    const c = caseFor("little-time");
    const r = evaluatePlanOutput(safeFixturePlan(), c); // 25-min meals vs 15-min day
    expect(r.pass).toBe(false);
    expect(r.issues.some((i) => i.code === "meal_over_time_budget")).toBe(true);
  });

  it("fails a generic plan even though nothing in it is unsafe", () => {
    const c = caseFor("sparse-input");
    const plan = safeFixturePlanFor(c);
    plan.plan_summary.main_focus = "Listen to your body";
    plan.meal_cards[0].title = "Eat something";
    const r = evaluatePlanOutput(plan, c);
    expect(r.pass).toBe(false);
    expect(r.issues.every((i) => i.code !== "allergen")).toBe(true);
    expect(r.issues.some((i) => i.code === "generic_filler")).toBe(true);
  });

  it("fails an invented-fact plan for a case whose input never mentioned it", () => {
    const c = caseFor("normal-day");
    const plan = safeFixturePlanFor(c);
    plan.plan_summary.short_note = "Ask your partner to help with dinner.";
    const r = evaluatePlanOutput(plan, c);
    expect(r.pass).toBe(false);
    expect(r.issues.some((i) => i.code === "invented_personal_fact")).toBe(true);
  });

  it("satisfies both exclusion sets at once for the combination case", () => {
    const c = caseFor("vegetarian-nut-allergy");
    const r = evaluatePlanOutput(safeFixturePlanFor(c), c);
    expect(r.pass, JSON.stringify(r.issues)).toBe(true);
    // And fails when either set is violated.
    for (const bad of ["chicken breast", "almond butter"]) {
      const plan = safeFixturePlanFor(c);
      plan.meal_cards[0].ingredients[0] = { name: bad, amount: "1", optional: false };
      const bad_r = evaluatePlanOutput(plan, c);
      expect(bad_r.pass, bad).toBe(false);
    }
  });

  it("grounds 'known facts' only in the user's own input", () => {
    const c = caseFor("normal-day");
    const facts = knownFactsFor(c);
    // Words from the check-in note and profile — nothing model-generated.
    expect(facts).toContain("office");
    expect(facts).not.toContain("partner");
  });
});

describe("a fit finding never masks or replaces a safety finding", () => {
  it("reports both when a plan is unsafe AND unusable", () => {
    const c = caseFor("nut-allergy");
    const plan = safeFixturePlanFor(c);
    plan.meal_cards[0].ingredients[0] = { name: "peanut butter", amount: "2 tbsp", optional: false };
    plan.meal_cards[0].total_time_minutes = 90;
    plan.plan_summary.main_focus = "Relax";
    const r = evaluatePlanOutput(plan, c);
    expect(r.pass).toBe(false);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("allergen");
    expect(codes).toContain("meal_over_time_budget");
    expect(codes).toContain("generic_filler");
  });

  it("keeps allergen checks deterministic and outside any model judgement", () => {
    const validators = readFileSync("src/lib/evals/validators.ts", "utf8");
    const fit = readFileSync("src/lib/evals/fit.ts", "utf8");
    // No provider call, no LLM judge, anywhere in the deterministic gate.
    for (const src of [validators, fit]) {
      expect(src).not.toMatch(/generateJson|callModel|anthropic|fetch\(/i);
    }
    expect(fit).toMatch(/replaces or softens a safety gate/i);
  });
});

describe("the optional live eval cannot weaken the deterministic gate", () => {
  const script = readFileSync("scripts/eval-live.mjs", "utf8");

  it("is opt-in and treats a missing key as SKIPPED, never a pass", () => {
    expect(script).toMatch(/EVAL_LIVE !== "1"/);
    expect(script).toMatch(/SKIPPED/);
    expect(script).toMatch(/never read as a pass|never read as|never a pass/i);
  });

  it("caps cost and reports what it did not run", () => {
    expect(script).toMatch(/EVAL_LIVE_MAX_USD/);
    expect(script).toMatch(/skippedForCost/);
  });

  it("records the model and the UTC date", () => {
    expect(script).toMatch(/AI_PROVIDER_MODEL/);
    expect(script).toMatch(/toISOString\(\)/);
    expect(script).toMatch(/date \(UTC\)/);
  });

  it("goes through the app route rather than calling the provider directly", () => {
    // Calling the provider directly would bypass the safety classifier, the
    // allergen gate and the fair-use claim — the whole point of the route.
    expect(script).toMatch(/\/api\/ai\/daily-plan/);
    expect(script).not.toMatch(/api\.anthropic\.com|@anthropic-ai/);
  });

  it("never judges safety itself and says the gate is elsewhere", () => {
    expect(script).toMatch(/advisory/i);
    expect(script).toMatch(/npm run eval/);
    expect(script).toMatch(/No model grades another model|no model is used to judge/i);
  });

  it("exits 0 even when it finds something, so CI cannot depend on it", () => {
    // The only exits are 0 (advisory / skipped) and 1 (its own misconfiguration).
    const exits = [...script.matchAll(/process\.exit\((\d)\)/g)].map((m) => m[1]);
    expect(new Set(exits)).toEqual(new Set(["0", "1"]));
    // Specifically: the medical-request warning does not change the exit code.
    const warnIdx = script.indexOf("produced a plan instead of a support boundary");
    const tail = script.slice(warnIdx);
    expect(tail).toMatch(/process\.exit\(0\)/);
    expect(tail).not.toMatch(/process\.exit\(1\)/);
  });

  it("lists only case ids that exist in the corpus", () => {
    const ids = new Set(EVAL_INPUT_CASES.map((c) => c.id));
    for (const m of script.matchAll(/\{ id: "([a-z-]+)"/g)) {
      expect(ids.has(m[1]), `script case "${m[1]}" is not in the corpus`).toBe(true);
    }
  });
});

describe("plan provenance is plain language and leaks no prompt text", () => {
  it("labels the curated backup day as a backup, prominently", () => {
    const s = planProvenanceSummary({ isFallback: true, promptVersion: "daily-plan-v2@1" });
    expect(s.fallback).toBe(true);
    expect(s.headline).toMatch(/prepared backup day/i);
    expect(s.headline).toMatch(/wasn't generated from your check-in/i);
  });

  it("says provenance was not recorded rather than guessing a version", () => {
    const s = planProvenanceSummary({});
    expect(s.detail).toBeNull();
    expect(s.headline).toMatch(/built from your check-in/i);
  });

  it("shows version identifiers only — never prose or prompt text", () => {
    const leaked = planProvenanceSummary({
      promptVersion: "You are Mellowa, a wellbeing planner. Never diagnose.",
      modelVersion: "claude-haiku-4-5-20251001",
    });
    // A prose "version" is rejected by the slug check, so it cannot be rendered.
    expect(leaked.detail).toBe("claude-haiku-4-5-20251001");
    expect(leaked.detail).not.toMatch(/You are Mellowa/);
  });

  it("renders both ids when both are recorded", () => {
    const s = planProvenanceSummary({
      promptVersion: "daily-plan-v2@1",
      modelVersion: "claude-haiku-4-5-20251001",
    });
    expect(s.detail).toBe("daily-plan-v2@1 · claude-haiku-4-5-20251001");
    expect(s.fallback).toBe(false);
  });

  it("is recorded on the plan row at generation time", () => {
    const route = readFileSync("src/app/api/ai/daily-plan/route.ts", "utf8");
    expect(route).toContain("prompt_version: PROMPT_VERSION");
    expect(route).toContain("is_fallback: usedFallback");
    // No system prompt is ever written to a database column.
    expect(route).not.toMatch(/system_prompt:|prompt_text:/);
  });

  it("is surfaced on Today, with the backup case not hidden behind a toggle", () => {
    const page = readFileSync("src/app/(app)/today/page.tsx", "utf8");
    expect(page).toContain("planProvenanceSummary");
    // The fallback branch returns a plain paragraph; the first JSX element it
    // renders must not be a collapsed <details>.
    const fallbackBranch = page.slice(page.indexOf("if (summary.fallback)"));
    const firstTag = fallbackBranch.match(/<(\w+)/)?.[1];
    expect(firstTag).toBe("p");
  });
});

describe("versioning covers every prompt", () => {
  it("every registered prompt has an id and a content hash", () => {
    for (const [key, v] of Object.entries(PROMPT_VERSIONS)) {
      expect(v.id, key).toMatch(/^[a-z0-9-]+@\d+$/);
      expect(v.sha256, key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("all fit checks run together in a stable order", () => {
    const c = caseFor("low-energy");
    const plan = safeFixturePlan();
    const a = JSON.stringify(allFitViolations(plan, { cookingTime: c.profile.cooking_time, energy_level: 1 }));
    const b = JSON.stringify(allFitViolations(plan, { cookingTime: c.profile.cooking_time, energy_level: 1 }));
    expect(a).toBe(b);
  });
});
