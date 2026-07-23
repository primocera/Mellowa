import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Navigation copy regression.
 * MW-V9-01 (Now-first IA): the four primary destinations are Today, Week,
 * Saved and You. Patterns moves off the top bar (it lives under You). Content
 * Elevation v6 copy for the Week/Patterns/Resets pages is unchanged. Routes
 * and URLs stay (/library keeps its route; its label is Saved).
 */

const nav = readFileSync("src/components/layout/app-nav.tsx", "utf8");
const week = readFileSync("src/app/(app)/plan/page.tsx", "utf8");
const patterns = readFileSync("src/app/(app)/progress/page.tsx", "utf8");
const library = readFileSync("src/app/(app)/library/page.tsx", "utf8");
const resets = readFileSync("src/app/(app)/stress-reset/page.tsx", "utf8");

describe("navigation copy (MW-V9-01)", () => {
  it("uses the four primary destination labels", () => {
    expect(nav).toContain('label: "Today"');
    expect(nav).toContain('label: "Week"');
    expect(nav).toContain('label: "Saved"');
    expect(nav).toContain('label: "You"');
    expect(nav).not.toContain('label: "Plan"');
    expect(nav).not.toContain('label: "Progress"');
    // Patterns and Library are no longer top-level nav labels.
    expect(nav).not.toContain('label: "Patterns"');
    expect(nav).not.toContain('label: "Library"');
  });

  it("preserves the underlying routes", () => {
    expect(nav).toContain('href: "/plan"');
    expect(nav).toContain('href: "/library"');
    expect(nav).toContain('href: "/you"');
  });

  it("Week hub describes what the user accomplishes", () => {
    expect(week).toContain('title: "Week — Mellowa"');
    expect(week).toContain("Make the week easier");
    expect(week).toContain("Week at a glance");
    expect(week).toContain("See the shape of the days ahead.");
  });

  it("Patterns hub is neutral and non-scoring", () => {
    expect(patterns).toContain('title: "Patterns — Mellowa"');
    expect(patterns).toContain("Notice what repeats, without scoring yourself");
  });

  it("Resets replaces Calm across the Library card and page", () => {
    expect(library).toContain('label: "Resets"');
    expect(library).not.toContain('label: "Calm"');
    expect(resets).toContain('title: "Resets — Mellowa"');
    expect(library).toContain("Brief practices for everyday tension or overload.");
  });
});
