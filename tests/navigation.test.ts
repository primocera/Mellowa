import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "..", "src", "app", "(app)");
const NAV = join(__dirname, "..", "src", "components", "layout", "app-nav.tsx");

describe("navigation refactor (Prompt 10)", () => {
  const nav = readFileSync(NAV, "utf8");

  it("exposes exactly five top-level destinations", () => {
    const hrefs = [...nav.matchAll(/href:\s*"(\/[a-z]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/today", "/plan", "/library", "/progress", "/you"]);
  });

  it("mobile bar respects a 44px minimum touch target", () => {
    expect(nav).toMatch(/min-h-\[44px\]/);
  });

  it("each hub destination has a page", () => {
    for (const hub of ["today", "plan", "library", "progress", "you"]) {
      expect(existsSync(join(APP, hub, "page.tsx"))).toBe(true);
    }
  });

  it("the old dashboard route redirects to today", () => {
    const dash = readFileSync(join(APP, "dashboard", "page.tsx"), "utf8");
    expect(dash).toMatch(/redirect\("\/today"\)/);
  });

  it("consolidated detail routes still exist (no dead links)", () => {
    for (const route of [
      "weekly-plan",
      "meal-rhythm",
      "favourites",
      "movement",
      "stress-reset",
      "habits",
      "journal",
      "settings",
      "billing",
    ]) {
      expect(existsSync(join(APP, route, "page.tsx"))).toBe(true);
    }
  });
});
