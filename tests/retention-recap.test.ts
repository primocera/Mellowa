import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeWeek } from "@/lib/retention/recap";

/** Daily retention loop (Launch v6, Prompt 22). */

const NOW = new Date("2026-07-17T12:00:00.000Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe("neutral weekly recap", () => {
  it("counts only plans created within the last 7 days", () => {
    const recap = summarizeWeek(
      [{ created_at: daysAgo(1) }, { created_at: daysAgo(6) }, { created_at: daysAgo(9) }],
      [],
      NOW
    );
    expect(recap.plansCreated).toBe(2);
    expect(recap.headline).toBe("You created 2 plans this week.");
  });

  it("aggregates feedback themes most-frequent-first, ignoring old rows", () => {
    const recap = summarizeWeek(
      [],
      [
        { verdict: "too_much", created_at: daysAgo(1) },
        { verdict: "too_much", created_at: daysAgo(2) },
        { verdict: "helpful", created_at: daysAgo(3) },
        { verdict: "too_much", created_at: daysAgo(10) }, // too old
      ],
      NOW
    );
    expect(recap.themes[0]).toMatchObject({ key: "too_much", count: 2 });
    expect(recap.themes.map((t) => t.key)).toEqual(["too_much", "helpful"]);
  });

  it("ignores unknown verdicts and handles an empty week calmly", () => {
    const recap = summarizeWeek([], [{ verdict: "junk", created_at: daysAgo(1) }], NOW);
    expect(recap.plansCreated).toBe(0);
    expect(recap.themes).toEqual([]);
    expect(recap.headline).toMatch(/whenever you're ready/i);
  });

  it("never emits adherence, streak or outcome language", () => {
    const recap = summarizeWeek(
      [{ created_at: daysAgo(1) }],
      [{ verdict: "helpful", created_at: daysAgo(1) }],
      NOW
    );
    const text = JSON.stringify(recap).toLowerCase();
    for (const bad of ["streak", "adherence", "completed", "in a row", "goal", "improve"]) {
      expect(text.includes(bad), `recap must not say "${bad}"`).toBe(false);
    }
  });
});

describe("today state and recap copy stay neutral", () => {
  it("recap card contains no streak/scorecard pressure", () => {
    // Scan rendered copy only — the doc-comment names the banned terms as the
    // rule, which is not a violation.
    const src = readFileSync("src/components/dailyflow/weekly-recap.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .toLowerCase();
    for (const bad of ["streak", "keep it up", "don't break", "adherence", "score"]) {
      // "scorecard" is allowed only in the explicit "not a scorecard" reassurance.
      if (bad === "score") {
        expect(src.includes("not a scorecard")).toBe(true);
        continue;
      }
      expect(src.includes(bad), `recap card must not say "${bad}"`).toBe(false);
    }
  });

  it("today page names an explicit top state for both branches", () => {
    const src = readFileSync("src/app/(app)/today/page.tsx", "utf8");
    expect(src).toContain("no plan yet");
    expect(src).toContain("plan ready");
  });
});
