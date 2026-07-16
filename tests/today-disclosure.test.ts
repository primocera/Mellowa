import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isLighterDay, pickCalmReset } from "@/lib/today/disclosure";

describe("Today progressive disclosure (Prompt 11)", () => {
  it("treats low-energy, high-stress, reset and minimum as lighter days", () => {
    for (const m of ["low_energy", "high_stress", "reset", "minimum"]) {
      expect(isLighterDay(m)).toBe(true);
    }
    for (const m of ["balanced", "normal", "busy_day", null, undefined]) {
      expect(isLighterDay(m)).toBe(false);
    }
  });

  it("surfaces exactly one calm reset, preferring the gentlest", () => {
    expect(pickCalmReset({ breathing: {}, meditation: {}, relaxation: {} })).toBe(
      "breathing"
    );
    expect(pickCalmReset({ meditation: {}, relaxation: {} })).toBe("meditation");
    expect(pickCalmReset({ relaxation: {} })).toBe("relaxation");
    expect(pickCalmReset({})).toBeNull();
  });

  it("Today page uses the calm, non-directive check-in copy", () => {
    const page = readFileSync(
      join(__dirname, "..", "src", "app", "(app)", "today", "page.tsx"),
      "utf8"
    );
    expect(page).toMatch(/How does today feel\?/);
    expect(page).toMatch(/Check in for today/);
  });

  it("Today plan renders a single 'One calm reset' heading, not all three", () => {
    const cmp = readFileSync(
      join(__dirname, "..", "src", "components", "dailyflow", "today-plan-v2.tsx"),
      "utf8"
    );
    expect(cmp).toMatch(/One calm reset/);
    expect(cmp).toMatch(/calmReset === "breathing"/);
  });
});
