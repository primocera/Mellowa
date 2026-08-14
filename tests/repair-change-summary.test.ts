import { describe, expect, it } from "vitest";
import {
  replaceableScope,
  repairChangeSummary,
  REPAIR_REASON_LABELS,
  type RepairPlanRow,
} from "@/lib/plan/repair";

/**
 * MW-V18-10: reshape transparency. The change summary tells the user what STAYS
 * (completed/kept work), what CHANGES (only the remaining day) and WHY (the
 * trigger) — derived from server facts, never the model's prose, so it is
 * deterministic and can never claim a completed item was rewritten.
 */

const plan: RepairPlanRow = {
  meal_cards: [
    { meal_type: "breakfast" } as never,
    { meal_type: "lunch" } as never,
    { meal_type: "dinner" } as never,
  ],
  movement_plan: { note: "walk" },
  evening_routine: { note: "wind down" },
  habit_focus: { habit: "water" },
};

describe("repairChangeSummary", () => {
  it("names the trigger, lists changes, and preserves completed/kept work", () => {
    // Breakfast completed, habit explicitly kept → both protected (stay).
    const scope = replaceableScope(plan, ["meal:breakfast"], ["habit"]);
    const summary = repairChangeSummary(scope, ["meals", "movement"], "lower_energy");

    expect(summary.trigger).toBe(REPAIR_REASON_LABELS.lower_energy);
    expect(summary.changes).toEqual(["meals", "movement"]);
    // Completed breakfast and kept habit are preserved.
    expect(summary.stays).toEqual(expect.arrayContaining(["the breakfast", "the habit"]));
    expect(summary.summary).toMatch(/your energy is lower/);
    expect(summary.summary).toMatch(/What you already did stays/);
  });

  it("handles a no-op reshape honestly", () => {
    const scope = replaceableScope(plan, [], []);
    const summary = repairChangeSummary(scope, [], "context_changed");
    expect(summary.changes).toEqual([]);
    expect(summary.summary).toMatch(/nothing in the rest of your day needed to change/);
  });

  it("with nothing protected, there is no 'stays' clause", () => {
    const scope = replaceableScope(plan, [], []);
    const summary = repairChangeSummary(scope, ["meals"], "less_time");
    expect(summary.stays).toEqual([]);
    expect(summary.summary).not.toMatch(/stays/);
  });
});
