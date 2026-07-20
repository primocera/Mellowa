import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Today hierarchy copy regression (Content Elevation v6, Prompt 8).
 * One coherent day: canonical section labels, elevated meal actions,
 * fit-to-day feedback, and no compliance pressure.
 */

const today = readFileSync("src/components/dailyflow/today-plan-v2.tsx", "utf8");
const feedback = readFileSync("src/components/dailyflow/plan-feedback.tsx", "utf8");

describe("today hierarchy copy (CE-8)", () => {
  it("greets with what fits today and a realistic fallback", () => {
    expect(today).toContain("Here&apos;s what fits today.");
    expect(today).toContain("A realistic plan for today");
  });

  it("uses the canonical section labels in order", () => {
    const labels = [
      "Meals that fit today",
      "A simple water cue",
      "If movement feels useful",
      "One pause for today",
      "One thing to protect",
      "A softer landing",
      "One repeatable step",
    ];
    let last = -1;
    for (const label of labels) {
      const idx = today.indexOf(label);
      expect(idx, label).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("uses the elevated meal and plan actions", () => {
    expect(today).toContain("See ingredients");
    expect(today).toContain("Swap this meal");
    expect(today).toContain("Make it easier");
    // MW-S02: the whole-day action is the atomic repair sheet.
    expect(today).toContain("Adjust the rest of today");
    expect(today).toContain("If today gets smaller:");
  });

  it("keeps completion optional with Done for now / Undo", () => {
    expect(today).toContain("Done for now");
    expect(today).toContain("Undo");
    expect(today).not.toContain("Mark done");
  });

  it("caps AI-provided reset names with canonical fallbacks", () => {
    expect(today).toContain("sectionName(plan.breathing_exercise.name");
    expect(today).toContain("sectionName(plan.meditation_or_reflection.name");
    expect(today).toContain("sectionName(plan.relaxation_technique.name");
  });

  it("closes with the canonical permission line", () => {
    expect(today).toContain("Use the structure that helps. Leave the rest.");
  });

  it("asks fit-to-day feedback, not plan rating", () => {
    expect(feedback).toContain("Did this plan fit the day you had?");
    expect(feedback).toContain("Mostly");
    expect(feedback).toContain("Not today");
    expect(feedback).toContain("Needed less time");
    expect(feedback).toContain("Wrong kind of support");
    expect(feedback).not.toContain("How was today");
  });
});
