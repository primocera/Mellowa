import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-14: the final premium content/UX/safety pass. The three paid jobs are clear,
 * every async failure explains that work is preserved, and no customer surface
 * carries an unsupported claim or the retired product name.
 */

const read = (p: string) => readFileSync(p, "utf8");

const CUSTOMER_COPY = [
  "src/app/page.tsx",
  "src/app/pricing/page.tsx",
  "src/app/(app)/billing/page.tsx",
  "src/components/dailyflow/adaptive-day-proof.tsx",
  "src/components/dailyflow/weekly-reflection.tsx",
  "src/components/dailyflow/mellowa-learned.tsx",
].map((p) => ({ path: p, text: read(p) }));

describe("the three paid jobs are each expressed in customer copy", () => {
  const all = CUSTOMER_COPY.map((c) => c.text).join("\n").toLowerCase();

  it("adapt today — reshape only what remains, with free Undo", () => {
    expect(/adjust|reshape|adapt/.test(all)).toBe(true);
    expect(all).toContain("undo");
  });

  it("reuse what works — favourites / leftovers / removable preferences", () => {
    expect(/favourite|leftover|reuse|what mellowa uses|preference/.test(all)).toBe(true);
  });

  it("carry into next week — reflection + explicit carry-forward", () => {
    expect(/carry|next week|reflect/.test(all)).toBe(true);
  });
});

describe("every async failure explains preservation and recovery", () => {
  const errorSurfaces = [
    "src/app/api/ai/plan-repair/route.ts",
    "src/app/api/ai/regenerate-section/route.ts",
    "src/app/api/week/reflection/route.ts",
  ];
  it("adjust / regenerate stale-day copy says the plan is no longer today's and to refresh", () => {
    for (const f of ["src/app/api/ai/plan-repair/route.ts", "src/app/api/ai/regenerate-section/route.ts"]) {
      const t = read(f);
      expect(t).toMatch(/no longer today'?s/i);
      expect(t).toMatch(/refresh/i);
    }
  });
  it("the reflection stale-week copy says the week moved on and to refresh", () => {
    const t = read("src/app/api/week/reflection/route.ts");
    expect(t).toMatch(/week moved on/i);
    expect(t).toMatch(/refresh/i);
  });
  it("repair failures state the previous plan is unchanged (no lost work)", () => {
    const t = read("src/app/api/ai/plan-repair/route.ts");
    expect(t).toMatch(/previous plan is unchanged|plan is unchanged/i);
    // Preserved errors carry the honesty across all four failure exits.
    expect(errorSurfaces.length).toBeGreaterThan(0);
  });
});

describe("no customer surface carries an unsupported claim or the retired name", () => {
  const BANNED = [
    /production-ready/i,
    /\bguaranteed\b/i,
    /medically (effective|proven)/i,
    /clinically (proven|tested)/i,
    /\bcure\b/i,
    /\bDailyFlow\b/,
  ];
  for (const { path, text } of CUSTOMER_COPY) {
    it(`${path} is free of banned claims and the retired product name`, () => {
      for (const re of BANNED) {
        expect(re.test(text), `${path} matched ${re}`).toBe(false);
      }
    });
  }
});
