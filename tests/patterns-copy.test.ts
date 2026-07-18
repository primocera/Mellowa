import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Patterns copy regression (Content Elevation v6, Prompt 12).
 * Progress becomes Patterns: neutral repetition/observation language, no
 * scores/streaks/causal claims, no praise for consistency or blame for gaps.
 */

const patterns = readFileSync("src/app/(app)/progress/page.tsx", "utf8");
const habits = readFileSync("src/components/dailyflow/habits-view.tsx", "utf8");
const habitsPage = readFileSync("src/app/(app)/habits/page.tsx", "utf8");
const journalPage = readFileSync("src/app/(app)/journal/page.tsx", "utf8");

describe("patterns copy (CE-12)", () => {
  it("uses the neutral heading and self-reported data note", () => {
    expect(patterns).toContain("Notice what repeats, without scoring yourself");
    expect(patterns).toContain(
      "These are self-reported entries, not health conclusions or predictions."
    );
  });

  it("uses the canonical section labels", () => {
    for (const label of [
      "Your last two weeks",
      "What repeated",
      "Habits you chose",
      "Questions worth carrying forward",
    ]) {
      expect(patterns).toContain(label);
    }
    expect(patterns).not.toContain("Worth noticing");
    expect(patterns).not.toContain("Recent wins");
  });

  it("shows missing days without judgment in the empty state", () => {
    expect(patterns).toContain("Patterns need a little time");
    expect(patterns).toContain("Mellowa does not treat them as failure");
    expect(patterns).not.toContain("Nothing here yet");
  });

  it("habits use Easiest version, not Minimum", () => {
    expect(habitsPage).toContain("Keep one thing easy to repeat");
    expect(habits).toContain("Easiest version:");
    expect(habits).not.toContain("Minimum: {");
  });

  it("journal is framed as general reflection, not therapy", () => {
    expect(journalPage.replace(/\s+/g, " ")).toContain(
      "not therapy or psychological interpretation."
    );
  });
});
