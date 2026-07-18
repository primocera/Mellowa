import { describe, expect, it } from "vitest";
import { EVAL_INPUT_CASES, safeFixturePlan, unsafeFixturePlan } from "@/lib/evals/corpus";
import { evaluateInputSafety, evaluatePlanOutput, summarize } from "@/lib/evals/validators";

/**
 * Launch evaluation suite (Launch v6, Prompt 12). Deterministic — no provider
 * calls. This is the regression gate npm test (and scripts/release-check) runs
 * before any prompt/model change ships. Live current-vs-candidate comparison
 * is a manual procedure documented in docs/prompt-versioning.md.
 */

describe("eval corpus coverage", () => {
  it("covers all required categories", () => {
    const cats = new Set(EVAL_INPUT_CASES.map((c) => c.category));
    for (const required of [
      "normal", "low_energy", "high_stress", "no_cook", "budget", "vegetarian",
      "allergy", "ambiguity", "injection",
      "safety_self_harm", "safety_eating_disorder", "safety_harm_others", "safety_medical",
    ]) {
      expect(cats.has(required as never), `missing category ${required}`).toBe(true);
    }
  });
});

describe("input safety gate", () => {
  for (const c of EVAL_INPUT_CASES) {
    it(`${c.id}: ${c.expectPreBlocked ? "blocked before generation" : "passes to classifier"}`, () => {
      const r = evaluateInputSafety(c);
      expect(r.pass, JSON.stringify(r.issues)).toBe(true);
    });
  }
});

describe("output validators", () => {
  it("passes a well-formed plan for every non-blocked case", () => {
    const results = EVAL_INPUT_CASES.filter((c) => !c.expectPreBlocked && c.forbiddenTerms.length === 0).map((c) =>
      evaluatePlanOutput(safeFixturePlan(), c)
    );
    const report = summarize(results);
    expect(report.criticalFailures, JSON.stringify(report.criticalFailures)).toEqual([]);
  });

  it("FAILS the deliberately unsafe candidate output (gate proof)", () => {
    const allergyCase = EVAL_INPUT_CASES.find((c) => c.id === "nut-allergy")!;
    const r = evaluatePlanOutput(unsafeFixturePlan(), allergyCase);
    expect(r.pass).toBe(false);
    const codes = r.issues.filter((i) => i.severity === "critical").map((i) => i.code);
    expect(codes).toContain("allergen"); // peanut butter vs peanut allergy
    expect(codes).toContain("quality"); // calorie framing + shame language
  });

  it("rejects schema-invalid output as critical", () => {
    const r = evaluatePlanOutput({ nonsense: true }, EVAL_INPUT_CASES[0]);
    expect(r.pass).toBe(false);
    expect(r.issues[0].code).toBe("schema_invalid");
  });

  it("catches forbidden terms for the vegetarian case", () => {
    const veg = EVAL_INPUT_CASES.find((c) => c.id === "vegetarian")!;
    const plan = safeFixturePlan();
    plan.meal_cards[0].title = "Chicken breast wrap";
    plan.meal_cards[0].ingredients[0].name = "chicken breast";
    const r = evaluatePlanOutput(plan, veg);
    expect(r.pass).toBe(false);
    expect(r.issues.some((i) => i.code === "forbidden_term")).toBe(true);
  });
});

describe("stability", () => {
  it("two identical runs produce identical results", () => {
    const run = () =>
      JSON.stringify(
        EVAL_INPUT_CASES.map((c) => [evaluateInputSafety(c), evaluatePlanOutput(safeFixturePlan(), c)])
      );
    expect(run()).toBe(run());
  });
});
