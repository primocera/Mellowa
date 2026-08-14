import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { preClassifySafety } from "@/lib/safety/pre-classify";

/**
 * MW-V18-13: no AI generation route may bypass pre-generation safety
 * classification. This is enforced structurally (every route calls
 * checkInputSafety BEFORE it generates and blocks on the result) and
 * behaviourally (the deterministic pre-classifier blocks the required safety
 * classes and fails closed).
 */

/** Every route that turns user text into an AI generation. */
const GENERATION_ROUTES = [
  { file: "src/app/api/ai/daily-plan/route.ts", gen: /generateDailyPlanV2\s*\(/ },
  { file: "src/app/api/ai/low-energy-day/route.ts", gen: /generateLowEnergyDay\s*\(/ },
  { file: "src/app/api/ai/meal-rhythm/route.ts", gen: /generateStructuredJson\s*\(/ },
  { file: "src/app/api/ai/habit-plan/route.ts", gen: /generateStructuredJson\s*\(/ },
  { file: "src/app/api/ai/weekly-plan/route.ts", gen: /generateWeeklyPlan\s*\(/ },
  { file: "src/app/api/ai/regenerate-section/route.ts", gen: /generateStructuredJson\s*\(/ },
  { file: "src/app/api/ai/journal-reflection/route.ts", gen: /generateStructuredJson\s*\(/ },
  { file: "src/app/api/ai/plan-repair/route.ts", gen: /generateStructuredJson\s*\(/ },
];

/** Strip import lines so a `generate…` in an import never counts as the call. */
function bodyOf(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*import\b/.test(l))
    .join("\n");
}

describe("every generation route classifies safety BEFORE generating", () => {
  for (const { file, gen } of GENERATION_ROUTES) {
    it(`${file} runs checkInputSafety before generation and blocks on it`, () => {
      const body = bodyOf(readFileSync(file, "utf8"));
      const safetyIdx = body.indexOf("checkInputSafety(");
      const genIdx = body.search(gen);
      expect(safetyIdx, `${file}: no checkInputSafety() call`).toBeGreaterThanOrEqual(0);
      expect(genIdx, `${file}: no generation call`).toBeGreaterThanOrEqual(0);
      expect(safetyIdx, `${file}: safety must precede generation`).toBeLessThan(genIdx);
      expect(body).toMatch(/should_block_generation/);
    });
  }
});

describe("the safety chain is deterministic-first and fails closed", () => {
  const src = readFileSync("src/lib/safety/check-input.ts", "utf8");
  it("runs the deterministic pre-classifier before the AI classifier", () => {
    const preIdx = src.indexOf("preClassifySafety(");
    const aiIdx = src.indexOf("generateStructuredJson(");
    expect(preIdx).toBeGreaterThanOrEqual(0);
    expect(aiIdx).toBeGreaterThan(preIdx);
  });
  it("fails closed to a blocking result when the classifier errors", () => {
    expect(src).toMatch(/BLOCKED_FALLBACK/);
    expect(src).toMatch(/should_block_generation:\s*true/);
  });
});

describe("pre-classifier blocks every required safety class", () => {
  const cases: { text: string; category: string }[] = [
    { text: "I want to kill myself", category: "self_harm" },
    { text: "I'm going to hurt someone", category: "harm_to_others" },
    { text: "I make myself throw up after eating", category: "eating_disorder" },
    { text: "I'm having chest pains and can't breathe", category: "medical_emergency" },
    { text: "give me a diabetes meal plan", category: "medical_nutrition" },
    { text: "I'm pregnant, plan my nutrition", category: "pregnancy" },
    { text: "help me withdraw from alcohol", category: "substance_misuse" },
  ];
  for (const c of cases) {
    it(`blocks ${c.category}`, () => {
      const r = preClassifySafety(c.text, "en-US");
      expect(r, c.text).not.toBeNull();
      expect(r!.should_block_generation).toBe(true);
      expect(r!.risk_types).toContain(c.category);
      expect(r!.user_message.length).toBeGreaterThan(0);
    });
  }

  it("does not false-positive on ordinary phrases", () => {
    expect(preClassifySafety("this deadline is killing me, need a calm day", "en-US")).toBeNull();
    expect(preClassifySafety("I walked 5 kms and want a light dinner", "en-US")).toBeNull();
  });
});
