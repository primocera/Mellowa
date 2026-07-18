import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Make Today Lighter copy regression (Content Elevation v6, Prompt 9).
 * The reduced-capacity feature keeps its behavior but loses childlike
 * "tiny plan" framing. Internal route/mode/schema names stay unchanged.
 */

const card = readFileSync("src/components/dailyflow/low-energy-day-card.tsx", "utf8");
const plans = readFileSync("src/lib/stripe/plans.ts", "utf8");

describe("make today lighter copy (CE-9)", () => {
  it("uses the elevated entry card", () => {
    expect(card).toContain("Need less from today?");
    expect(card).toContain(
      "Build the lightest useful version from the energy, time and food you already have."
    );
    expect(card).toContain("Make today lighter");
  });

  it("uses the elevated form and loading copy", () => {
    expect(card).toContain("What is available right now?");
    expect(card).toContain("Answer only what helps. Everything is optional.");
    expect(card).toContain("Build the lightest version");
    expect(card).toContain("Making the day simpler…");
  });

  it("uses the elevated output labels", () => {
    expect(card).toContain("Enough for today");
    expect(card).toContain("Easiest food option");
    expect(card).toContain("One recovery cue");
    expect(card).toContain("Everything else can wait.");
  });

  it("has no customer-facing tiny plan / tiny habit copy", () => {
    // one_tiny_habit is a schema field name, allowed; display copy is not.
    const display = card.replace(/one_tiny_habit/g, "");
    expect(display).not.toMatch(/tiny/i);
  });

  it("names Make-today-lighter mode in the premium feature list", () => {
    expect(plans).toContain("Make-today-lighter mode");
    expect(plans).not.toMatch(/Low-energy day mode/);
  });
});
