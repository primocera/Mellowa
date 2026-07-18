import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Daily check-in copy regression (Content Elevation v6, Prompt 7).
 * Capacity language instead of wellbeing scoring, elevated time/context/mode
 * copy, draft-preserving error messages, and the canonical CTA/loading lines.
 * Internal mode values stay unchanged ("minimum" renders as Lightest version).
 */

const form = readFileSync("src/components/dailyflow/checkin-form.tsx", "utf8");
const page = readFileSync("src/app/(app)/check-in/page.tsx", "utf8");

describe("daily check-in copy (CE-7)", () => {
  it("frames the check-in as a one-minute day question", () => {
    expect(page).toContain("What kind of day is this?");
    expect(page).toContain("One minute. Approximate is enough.");
  });

  it("uses capacity anchors, not wellbeing scores", () => {
    expect(form).toContain("Energy available today");
    expect(form).toContain("Running low");
    expect(form).toContain("Plenty available");
    expect(form).not.toContain("Feeling great");
  });

  it("uses the elevated time and context choices", () => {
    for (const t of [
      "Almost none",
      "About 10 minutes",
      "About 20 minutes",
      "About 30 minutes",
      "Flexible today",
    ]) {
      expect(form).toContain(t);
    }
    expect(form).toContain("How much room do you have for yourself?");
    for (const c of ["Busy", "Low capacity", "Out of routine", "At home", "On the go", "Social day"]) {
      expect(form).toContain(c);
    }
  });

  it("renames Minimum day to Lightest version while keeping the internal value", () => {
    expect(form).toContain('value: "minimum", label: "Lightest version"');
    expect(form).toContain("What should the plan prioritize?");
    expect(form).not.toMatch(/label: "Minimum day"/i);
  });

  it("states that drafts survive errors", () => {
    expect(form).toContain("Your check-in is saved on this device");
    expect(form).toContain("Your check-in draft will stay here.");
  });

  it("uses the canonical CTA, loading and secondary action", () => {
    expect(form).toContain("Shape today&apos;s plan".replace("&apos;", "'"));
    expect(form).toContain("Matching the plan to your time and energy…");
    expect(form).toContain("Give me the lightest version");
    expect(form).toContain("Making the day simpler…");
  });
});
