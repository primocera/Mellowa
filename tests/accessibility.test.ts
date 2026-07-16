import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8");

describe("accessibility primitives (Prompt 19)", () => {
  it("honours reduced-motion and defines a skip link", () => {
    const css = read("src", "app", "globals.css");
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/\.skip-link/);
  });

  it("the app shell has a skip link and a main landmark", () => {
    const layout = read("src", "app", "(app)", "layout.tsx");
    expect(layout).toMatch(/href="#main"/);
    expect(layout).toMatch(/<main id="main"/);
  });

  it("Today status messages are announced via a live region", () => {
    const cmp = read("src", "components", "dailyflow", "today-plan-v2.tsx");
    expect(cmp).toMatch(/aria-live="polite"/);
    expect(cmp).toMatch(/role="status"/);
  });

  it("error messages use assertive alert roles", () => {
    const onboarding = read(
      "src",
      "components",
      "dailyflow",
      "onboarding-wizard.tsx"
    );
    expect(onboarding).toMatch(/role="alert"/);
  });

  it("the mobile nav keeps 44px touch targets", () => {
    const nav = read("src", "components", "layout", "app-nav.tsx");
    expect(nav).toMatch(/min-h-\[44px\]/);
  });
});
