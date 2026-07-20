import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENT_NAMES, FUNNELS } from "@/lib/analytics/taxonomy";

/**
 * MW-S10: the v8 analytics contract document must stay in lockstep with the
 * code taxonomy, the value_loop funnel must be well-formed, and the two beta
 * experiment kill switches must actually gate their routes.
 */

const doc = readFileSync("docs/analytics-events-v8.md", "utf8");

describe("v8 analytics contract document", () => {
  it("documents every event in the code taxonomy", () => {
    for (const event of EVENT_NAMES) {
      expect(doc.includes(event), `docs/analytics-events-v8.md missing event: ${event}`).toBe(true);
    }
  });

  it("states the global prohibition on sensitive properties", () => {
    expect(doc).toMatch(/notes, journal text, allergies/i);
    expect(doc).toMatch(/free text/i);
  });

  it("defines beta experiments with rollback switches and stop criteria", () => {
    expect(doc).toMatch(/FLAG_PLAN_REPAIR=0/);
    expect(doc).toMatch(/FLAG_WEEKLY_REFLECTION=0/);
    expect(doc).toMatch(/stop criteria/i);
    expect(doc).toMatch(/≤50|50 invites/);
  });
});

describe("value_loop funnel", () => {
  it("exists, is ordered account → renewal, and only uses known events", () => {
    const funnel = FUNNELS.value_loop;
    expect(funnel[0]).toBe("signup_completed");
    expect(funnel[funnel.length - 1]).toBe("subscription_renewed");
    expect(funnel).toContain("now_action_done");
    expect(funnel).toContain("plan_repair_completed");
    expect(funnel).toContain("weekly_reflection_completed");
    for (const event of funnel) {
      expect(EVENT_NAMES).toContain(event);
    }
  });
});

describe("experiment kill switches", () => {
  it("flags.ts registers plan_repair and weekly_reflection", () => {
    const flags = readFileSync("src/lib/flags.ts", "utf8");
    expect(flags).toMatch(/"plan_repair"/);
    expect(flags).toMatch(/"weekly_reflection"/);
  });

  it("plan-repair route checks its flag before doing anything", () => {
    const route = readFileSync("src/app/api/ai/plan-repair/route.ts", "utf8");
    expect(route).toMatch(/isFlagEnabled\("plan_repair"\)/);
    expect(route).toMatch(/feature_paused/);
  });

  it("weekly reflection POST checks its flag before writing", () => {
    const route = readFileSync("src/app/api/week/reflection/route.ts", "utf8");
    expect(route).toMatch(/isFlagEnabled\("weekly_reflection"\)/);
    expect(route).toMatch(/feature_paused/);
  });
});
