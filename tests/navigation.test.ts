import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "..", "src", "app", "(app)");
const NAV = join(__dirname, "..", "src", "components", "layout", "app-nav.tsx");

describe("navigation refactor (MW-V9-01 Now-first IA)", () => {
  const nav = readFileSync(NAV, "utf8");

  it("exposes exactly four primary destinations: Today, Week, Saved, You", () => {
    const hrefs = [...nav.matchAll(/href:\s*"(\/[a-z]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/today", "/plan", "/library", "/you"]);
  });

  it("mobile bar respects a 44px minimum touch target", () => {
    expect(nav).toMatch(/min-h-\[44px\]/);
  });

  it("fires primary_nav_viewed with destination + entitlement only", () => {
    expect(nav).toContain('trackClient("primary_nav_viewed"');
    expect(nav).toContain("entitlement");
  });

  it("each primary destination has a page", () => {
    for (const hub of ["today", "plan", "library", "you"]) {
      expect(existsSync(join(APP, hub, "page.tsx"))).toBe(true);
    }
  });

  it("Patterns remains reachable off the top bar (under You)", () => {
    const you = readFileSync(join(APP, "you", "page.tsx"), "utf8");
    expect(you).toContain('href: "/progress"');
    expect(existsSync(join(APP, "progress", "page.tsx"))).toBe(true);
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
