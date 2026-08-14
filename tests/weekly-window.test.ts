import { describe, expect, it } from "vitest";
import {
  weekStartFor,
  reflectionWindow,
  reflectionStateForWeek,
  resolveCarryForward,
  type CarryForwardItem,
} from "@/lib/weekly/window";

/**
 * MW-V18-11: week boundaries are timezone-safe, a not-yet-elapsed week is
 * PENDING (never "missed"), and carry-forward only carries what the user
 * explicitly accepted or edited.
 */

describe("week boundaries are local and Monday-based", () => {
  it("returns the local Monday of the containing week", () => {
    // 2026-08-14 is a Friday → that week's Monday is 2026-08-10.
    expect(weekStartFor("2026-08-14T09:00:00Z", "UTC")).toBe("2026-08-10");
    // Sunday 2026-08-16 still belongs to the week starting Monday 2026-08-10.
    expect(weekStartFor("2026-08-16T09:00:00Z", "UTC")).toBe("2026-08-10");
    // Monday 2026-08-17 starts a new week.
    expect(weekStartFor("2026-08-17T00:30:00Z", "UTC")).toBe("2026-08-17");
  });

  it("respects the user's timezone at the day boundary", () => {
    // 2026-08-17T00:30Z is still Sunday 2026-08-16 in New York (UTC-4) → prior week.
    expect(weekStartFor("2026-08-17T00:30:00Z", "America/New_York")).toBe("2026-08-10");
  });
});

describe("reflection window", () => {
  it("targets the previous local week", () => {
    const w = reflectionWindow(new Date("2026-08-14T09:00:00Z"), "UTC")!;
    expect(w.currentWeekStart).toBe("2026-08-10");
    expect(w.reflectionWeekStart).toBe("2026-08-03");
    expect(w.reflectionWeekMature).toBe(true);
  });
});

describe("state is pending (not missed) until a week elapses", () => {
  const now = new Date("2026-08-14T09:00:00Z"); // week of 2026-08-10

  it("a fully-elapsed week with no reflection is available", () => {
    expect(reflectionStateForWeek("2026-08-03", now, "UTC", false)).toBe("available");
  });

  it("the in-progress week is pending, never missed", () => {
    expect(reflectionStateForWeek("2026-08-10", now, "UTC", false)).toBe("pending");
  });

  it("a completed reflection is completed regardless of maturity", () => {
    expect(reflectionStateForWeek("2026-08-03", now, "UTC", true)).toBe("completed");
  });
});

describe("carry-forward only carries explicit decisions", () => {
  it("accepts, applies edits, and drops rejections; silence carries nothing", () => {
    const items: CarryForwardItem[] = [
      { suggestion: "protein_breakfast", decision: "accepted", source: "last_week" },
      { suggestion: "evening_walk", decision: "edited", editedTo: "morning_walk", source: "learned_preference" },
      { suggestion: "big_dinner", decision: "rejected", source: "last_week" },
    ];
    expect(resolveCarryForward(items)).toEqual(["protein_breakfast", "morning_walk"]);
  });

  it("an edited decision with no editedTo carries nothing (no silent default)", () => {
    const items: CarryForwardItem[] = [{ suggestion: "x", decision: "edited", source: "default" }];
    expect(resolveCarryForward(items)).toEqual([]);
  });
});
