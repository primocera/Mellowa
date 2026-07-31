import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PREMIUM_FEATURES,
  PREMIUM_VALUE,
  premiumProblemFor,
} from "@/lib/stripe/plans";

/**
 * MW-V12-06: the recurring-value contract, and the boundaries it must keep.
 *
 * The free sample proves one realistic day; Premium is the ongoing loop across
 * changing days and weeks. This file pins that distinction and makes sure the
 * paywall names the PROBLEM each capability solves rather than listing abstract
 * features — and that no capability or its problem line crosses the product's
 * boundaries into "AI knows you", health outcomes, therapy, streaks or calories.
 */

/** Phrases the product must never claim, on any tier surface. */
const FORBIDDEN = [
  /knows? you/i,
  /improve[sd]? your health|health outcome/i,
  /therap(y|ist)/i,
  /\bstreak/i,
  /calorie|macro target/i,
  /\bunlimited\b/i,
  /\bcure\b/i,
  /guarantee/i,
  /lose weight|weight loss/i,
];

describe("the Premium value contract pairs each capability with a problem", () => {
  it("derives the rendered features from the contract, so they cannot drift", () => {
    expect(PREMIUM_FEATURES).toEqual(PREMIUM_VALUE.map((v) => v.capability));
  });

  it("gives every capability a real user problem, not an empty subtitle", () => {
    for (const v of PREMIUM_VALUE) {
      expect(v.problem.trim().length, `${v.capability} has no problem`).toBeGreaterThan(20);
      // The problem must not merely restate the capability verbatim.
      expect(v.problem).not.toBe(v.capability);
    }
  });

  it("covers all three phases of the loop", () => {
    const phases = new Set(PREMIUM_VALUE.map((v) => v.phase));
    expect(phases).toEqual(new Set(["adapt today", "reuse what works", "carry into next week"]));
  });

  it("keeps the core promise: reshape what's left without starting over", () => {
    const problems = PREMIUM_VALUE.map((v) => v.problem).join(" ");
    expect(problems).toMatch(/reshape what's left/i);
    expect(problems).toMatch(/without starting over/i);
  });

  it("names the recurring difference: the sample is one day, Premium continues", () => {
    const problems = PREMIUM_VALUE.map((v) => v.problem).join(" ");
    expect(problems).toMatch(/the sample is one day/i);
  });

  it("keeps preference learning inspectable and removable, in the copy itself", () => {
    // The product boundary: the user can see, edit and remove what was learned.
    expect(PREMIUM_FEATURES.join(" ")).toMatch(/you can see, edit and remove/i);
  });

  it("crosses none of the product boundaries", () => {
    const surface = PREMIUM_VALUE.map((v) => `${v.capability} ${v.problem}`).join(" ");
    for (const banned of FORBIDDEN) {
      expect(surface, `the contract contains a forbidden claim ${banned}`).not.toMatch(banned);
    }
  });

  it("resolves a problem for a known capability and null for an unknown one", () => {
    expect(premiumProblemFor(PREMIUM_VALUE[0].capability)).toBe(PREMIUM_VALUE[0].problem);
    expect(premiumProblemFor("Something we do not sell")).toBeNull();
  });
});

describe("the surfaces render the recurring-value framing", () => {
  it("the paywall renders each capability's problem line", () => {
    const pricing = readFileSync("src/app/pricing/page.tsx", "utf8");
    expect(pricing).toContain("premiumProblemFor");
  });

  it("the landing makes the sample-vs-Premium loop explicit", () => {
    const landing = readFileSync("src/app/page.tsx", "utf8");
    expect(landing).toMatch(/free sample is one day.*Premium is the ongoing loop/i);
  });

  it("states the medical boundary and makes no boundary-crossing claim", () => {
    const pricing = readFileSync("src/app/pricing/page.tsx", "utf8");
    // The boundary is stated, not claimed away — the word "therapy" here is the
    // disclaimer ("not ... therapy"), which is exactly what should be present.
    expect(pricing).toMatch(/not medical care, therapy or emergency support/i);
    // But no capability may claim to know the user, drive a streak, or promise
    // weight loss.
    for (const banned of [/knows? you/i, /\bstreak/i, /weight loss/i]) {
      expect(pricing).not.toMatch(banned);
    }
  });
});
