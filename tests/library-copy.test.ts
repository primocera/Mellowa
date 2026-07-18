import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Library / movement / resets copy regression (Content Elevation v6, Prompt 11).
 * The Library is low-effort reuse, not a catalogue to complete. Empty states
 * grant permission not to organize; movement/reset cautions stay specific.
 */

const library = readFileSync("src/app/(app)/library/page.tsx", "utf8");
const favourites = readFileSync(
  "src/components/dailyflow/favourites-view.tsx",
  "utf8"
);
const movement = readFileSync("src/app/(app)/movement/page.tsx", "utf8");
const resets = readFileSync("src/app/(app)/stress-reset/page.tsx", "utf8");

describe("library copy (CE-11)", () => {
  it("positions the Library as ready-to-reuse", () => {
    expect(library).toContain("Useful things, ready when you need them");
    expect(library.replace(/\s+/g, " ")).toContain(
      "reuse without creating a new plan."
    );
  });

  it("grants permission not to organize in the empty state", () => {
    expect(favourites).toContain("Nothing saved yet—and nothing to organize.");
    expect(favourites).toContain(
      "Save a meal from Today when it genuinely feels reusable."
    );
  });

  it("keeps movement general with specific cautions", () => {
    expect(movement).toContain("Choose what fits your body today");
    expect(movement.replace(/\s+/g, " ")).toContain(
      "Stop if anything causes pain, dizziness or unusual discomfort."
    );
  });

  it("keeps resets for everyday tension, not treatment", () => {
    expect(resets).toContain("A short pause, when one would help");
    expect(resets.replace(/\s+/g, " ")).toContain(
      "not treatment for panic, anxiety, trauma or depression."
    );
  });
});
