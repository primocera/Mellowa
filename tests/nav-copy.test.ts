import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Navigation copy regression (Content Elevation v6, Prompt 2).
 * Five hubs renamed around user intent: Plan→Week, Progress→Patterns,
 * Calm→Resets. Today, Library and You are unchanged. Routes/URLs stay.
 */

const nav = readFileSync("src/components/layout/app-nav.tsx", "utf8");
const week = readFileSync("src/app/(app)/plan/page.tsx", "utf8");
const patterns = readFileSync("src/app/(app)/progress/page.tsx", "utf8");
const library = readFileSync("src/app/(app)/library/page.tsx", "utf8");
const resets = readFileSync("src/app/(app)/stress-reset/page.tsx", "utf8");

describe("navigation copy (CE-2)", () => {
  it("uses the elevated top-level labels", () => {
    expect(nav).toContain('label: "Week"');
    expect(nav).toContain('label: "Patterns"');
    expect(nav).toContain('label: "Today"');
    expect(nav).toContain('label: "Library"');
    expect(nav).toContain('label: "You"');
    expect(nav).not.toContain('label: "Plan"');
    expect(nav).not.toContain('label: "Progress"');
  });

  it("preserves the underlying routes", () => {
    expect(nav).toContain('href: "/plan"');
    expect(nav).toContain('href: "/progress"');
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
