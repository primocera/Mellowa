import { describe, expect, it } from "vitest";
import { weeklyFactsForWindow, isInLocalWeek } from "@/lib/week/reflection";

/**
 * MW-03: weekly reflection facts are bounded by the user's EXACT local
 * Monday-Sunday week, not a rolling seven days and not the server's week. A row
 * is classified by its LOCAL calendar date in the user's timezone.
 */

describe("isInLocalWeek", () => {
  const weekStart = "2026-08-03"; // Monday

  it("Sunday 23:59 local belongs to the week; Monday 00:00 local does not", () => {
    // Ljubljana is UTC+2 in summer.
    // 2026-08-09 (Sun) 23:59 local = 2026-08-09T21:59Z → in week.
    expect(isInLocalWeek("2026-08-09T21:59:00Z", weekStart, "Europe/Ljubljana")).toBe(true);
    // 2026-08-10 (Mon) 00:00 local = 2026-08-09T22:00Z → next week.
    expect(isInLocalWeek("2026-08-09T22:00:00Z", weekStart, "Europe/Ljubljana")).toBe(false);
  });

  it("Monday 00:00 local of the week itself is included", () => {
    // 2026-08-03 00:00 Ljubljana = 2026-08-02T22:00Z.
    expect(isInLocalWeek("2026-08-02T22:00:00Z", weekStart, "Europe/Ljubljana")).toBe(true);
    // One minute earlier local is the prior week.
    expect(isInLocalWeek("2026-08-02T21:59:00Z", weekStart, "Europe/Ljubljana")).toBe(false);
  });

  it("UTC+14 and UTC-12 classify by local date, not the UTC instant", () => {
    // 2026-08-02T12:00Z is 2026-08-03 02:00 in Kiritimati (UTC+14) → in week.
    expect(isInLocalWeek("2026-08-02T12:00:00Z", weekStart, "Pacific/Kiritimati")).toBe(true);
    // Same instant in UTC-12 is 2026-08-02 00:00 → prior week.
    expect(isInLocalWeek("2026-08-02T12:00:00Z", weekStart, "Etc/GMT+12")).toBe(false);
  });

  it("a malformed timestamp is never in-week", () => {
    expect(isInLocalWeek("not-a-date", weekStart, "UTC")).toBe(false);
  });
});

describe("weeklyFactsForWindow", () => {
  const weekStart = "2026-08-03";
  const tz = "Europe/Ljubljana";

  it("counts only rows whose local date is inside the completed week", () => {
    const facts = weeklyFactsForWindow(
      {
        plans: [
          { created_at: "2026-08-03T08:00:00Z", plan_mode: "balanced" }, // Mon, in
          { created_at: "2026-08-09T21:59:00Z", plan_mode: "minimum" }, // Sun 23:59 local, in
          { created_at: "2026-08-09T22:00:00Z", plan_mode: "balanced" }, // Mon next wk, out
          { created_at: "2026-07-31T08:00:00Z", plan_mode: "balanced" }, // prior wk, out
        ],
        feedback: [{ verdict: "helpful", created_at: "2026-08-04T10:00:00Z" }],
        favourites: [{ created_at: "2026-08-15T10:00:00Z" }], // far out
      },
      weekStart,
      tz
    );
    const plansFact = facts.find((f) => f.source === "plans");
    expect(plansFact?.text).toBe("You created 2 daily plans.");
    expect(facts.find((f) => f.source === "feedback")?.text).toContain("1 item as helpful");
    // The out-of-week favourite is excluded.
    expect(facts.find((f) => f.source === "favourites")).toBeUndefined();
  });

  it("an empty week yields no facts (sparse week is honest, not invented)", () => {
    expect(
      weeklyFactsForWindow({ plans: [], feedback: [], favourites: [] }, weekStart, tz)
    ).toEqual([]);
  });
});
