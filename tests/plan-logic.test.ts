import { describe, it, expect } from "vitest";
import { resolvePlanMode } from "@/lib/ai/plan-mode";
import { pickMovement, pickEvening } from "@/lib/content/wellbeing-library";

describe("plan mode resolution (P2)", () => {
  it("respects an explicit mode", () => {
    expect(
      resolvePlanMode({ requestedMode: "reset", energy_level: 5, stress_level: 1, time_available: "" })
    ).toBe("reset");
  });

  it("very low energy resolves to minimum", () => {
    expect(
      resolvePlanMode({ requestedMode: "auto", energy_level: 1, stress_level: 2, time_available: "" })
    ).toBe("minimum");
  });

  it("high stress resolves to reset", () => {
    expect(
      resolvePlanMode({ requestedMode: "auto", energy_level: 4, stress_level: 5, time_available: "" })
    ).toBe("reset");
  });

  it("defaults to balanced", () => {
    expect(
      resolvePlanMode({ requestedMode: "auto", energy_level: 3, stress_level: 3, time_available: "" })
    ).toBe("balanced");
  });
});

describe("curated movement picker (P8)", () => {
  it("never returns floor work for knee limitations", () => {
    for (let i = 0; i < 20; i++) {
      const m = pickMovement(`seed${i}`, { limitations: "sensitive knees" });
      expect(m.title).not.toMatch(/floor/i);
      expect(m.intensity).not.toBe("moderate");
    }
  });

  it("returns a complete movement block", () => {
    const m = pickMovement("x", {});
    expect(m.steps.length).toBeGreaterThanOrEqual(2);
    expect(m.caution_note).toContain("pain");
  });
});

describe("evening routine picker (P9)", () => {
  it("maps preferred length to routine size", () => {
    expect(pickEvening("a", "5_min").steps.length).toBeLessThanOrEqual(2);
    expect(pickEvening("a", "20_min").steps.length).toBeGreaterThanOrEqual(5);
  });
});
