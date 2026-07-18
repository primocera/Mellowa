import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MELLOWA_VOICE_RULES } from "@/prompts/voice";
import { DAILY_PLAN_V2_SYSTEM_PROMPT } from "@/prompts/daily-plan-v2";
import { HABIT_PLAN_SYSTEM_PROMPT } from "@/prompts/habits";
import { LOW_ENERGY_DAY_SYSTEM_PROMPT } from "@/prompts/low-energy-day";
import { MEAL_RHYTHM_SYSTEM_PROMPT } from "@/prompts/meal-rhythm";
import { WEEKLY_PLAN_SYSTEM_PROMPT } from "@/prompts/weekly-plan";

/**
 * AI voice regression (Content Elevation v6, Prompt 18).
 * Every generation system prompt carries the shared voice rules; the
 * post-generation quality gate rejects prohibited language.
 */

describe("AI voice rules (CE-18)", () => {
  it("defines the canonical patterns", () => {
    expect(MELLOWA_VOICE_RULES).toContain("Everything else can wait.");
    expect(MELLOWA_VOICE_RULES).toContain('never "you\'ve got this"');
    expect(MELLOWA_VOICE_RULES).toContain("No moral food language");
    expect(MELLOWA_VOICE_RULES).toContain("No pseudo-clinical claims");
  });

  it("is embedded in every generation system prompt", () => {
    for (const prompt of [
      DAILY_PLAN_V2_SYSTEM_PROMPT,
      HABIT_PLAN_SYSTEM_PROMPT,
      LOW_ENERGY_DAY_SYSTEM_PROMPT,
      MEAL_RHYTHM_SYSTEM_PROMPT,
      WEEKLY_PLAN_SYSTEM_PROMPT,
    ]) {
      expect(prompt).toContain("VOICE RULES");
    }
  });

  it("is embedded in the journal reflection prompt", () => {
    // The prompt moved to src/prompts/journal.ts (LS-12/13 versioning).
    const prompt = readFileSync("src/prompts/journal.ts", "utf8");
    expect(prompt).toContain("MELLOWA_VOICE_RULES");
    const route = readFileSync("src/app/api/ai/journal-reflection/route.ts", "utf8");
    expect(route).toContain("JOURNAL_SYSTEM_PROMPT");
  });

  it("quality gate bans cheerleading, invented emotion and pseudo-clinical claims", () => {
    const checks = readFileSync("src/lib/ai/quality-checks.ts", "utf8");
    expect(checks).toContain("banned cheerleading phrase");
    expect(checks).toContain("invented emotion");
    expect(checks).toContain("pseudo-clinical claim");
    expect(checks).toContain("moral food language");
  });
});
