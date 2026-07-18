import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Onboarding copy regression (Content Elevation v6, Prompt 6).
 * The six-step wizard uses the elevated names, headings and helpers; goal
 * options are concrete daily-life outcomes; the final CTA leads into the
 * daily loop. Stored values must stay unchanged — only display copy moves.
 */

const wizard = readFileSync("src/components/dailyflow/onboarding-wizard.tsx", "utf8");
const page = readFileSync("src/app/(app)/onboarding/page.tsx", "utf8");

describe("onboarding copy (CE-6)", () => {
  it("frames setup as one-time basics with short daily check-ins", () => {
    expect(page).toContain("Set the basics once. Keep daily check-ins short.");
    expect(page).toContain("About two minutes. Your answers can be changed anytime.");
  });

  it("uses the six elevated step names and autosave note", () => {
    for (const name of [
      "Your rhythm",
      "What you want help with",
      "Food that fits",
      "Your usual capacity",
      "Voice",
      "Boundaries",
    ]) {
      expect(wizard).toContain(name);
    }
    expect(wizard).toContain("Saved on this device");
  });

  it("uses the elevated step headings", () => {
    expect(wizard).toContain("When does your day usually begin and end?");
    expect(wizard).toContain("What would make daily life easier right now?");
    expect(wizard).toContain("What should meals work around?");
    expect(wizard).toContain("What does a typical week feel like?");
    expect(wizard).toContain("How should Mellowa sound?");
    expect(wizard).toContain("Before your first plan");
  });

  it("says 'Approximate is enough' exactly once", () => {
    expect(wizard.match(/Approximate is enough/g)?.length).toBe(1);
  });

  it("replaces broad goals with concrete daily-life outcomes (values unchanged)", () => {
    for (const label of [
      "Eat more regularly",
      "Have steadier daily structure",
      "Wind down more easily",
      "Build one repeatable habit",
      "Feel less scattered",
    ]) {
      expect(wizard).toContain(label);
    }
    for (const value of [
      "more_energy",
      "better_meal_rhythm",
      "less_overwhelm",
      "better_sleep_routine",
      "habit_consistency",
      "general_wellbeing_structure",
    ]) {
      expect(wizard).toContain(value);
    }
  });

  it("frames capacity as a starting point, not a score", () => {
    expect(wizard).toContain("This is a starting point, not a score.");
    expect(wizard).toContain("Usual energy");
    expect(wizard).toContain("Usual stress");
  });

  it("keeps severe-allergy boundary direct and shows non-food features remain", () => {
    expect(wizard).toContain("won&apos;t suggest specific meals for severe");
    expect(wizard).toContain("non-food planning features");
  });

  it("ends with the boundaries acknowledgement and first-check-in CTA", () => {
    expect(wizard).toContain("I understand what Mellowa can and cannot provide.");
    expect(wizard).toContain("Create my first check-in");
  });
});
