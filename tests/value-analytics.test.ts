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

describe("MW-V9-11 beta value loop covers the full journey", () => {
  const funnel = FUNNELS.value_loop as readonly string[];

  it("spans signup → renewal through every value milestone", () => {
    const required = [
      "signup_completed",
      "onboarding_completed",
      "sample_plan_generated",
      "sample_plan_opened",
      "sample_value_action_completed",
      "trial_started",
      "checkin_completed",
      "now_action_done",
      "plan_repair_completed",
      "weekly_reflection_completed",
      "next_week_plan_created",
      "subscription_renewed",
    ];
    for (const e of required) expect(funnel).toContain(e);
    expect(funnel[0]).toBe("signup_completed");
    expect(funnel[funnel.length - 1]).toBe("subscription_renewed");
  });

  it("stays ordered and uses only known events (no duplicate source of truth)", () => {
    for (const e of funnel) expect(EVENT_NAMES).toContain(e);
    // No repeated step.
    expect(new Set(funnel).size).toBe(funnel.length);
  });
});

describe("MW-V9-11 beta research doc maps metrics to decisions", () => {
  const research = readFileSync("docs/beta-research.md", "utf8");

  it("maps the funnel to product decisions and the no-data state", () => {
    expect(research).toContain("value-loop funnel");
    expect(research).toMatch(/numerator|distinct-subject/i);
    expect(research).toMatch(/suppressed as/i);
  });

  it("has five consented interview scripts asking about load/fit/trust/price", () => {
    for (const s of [
      "Sample, no return",
      "Now defer / ignore",
      "Repair Undo / failure",
      "Weekly, no return",
      "Cancellation",
    ]) {
      expect(research).toContain(s);
    }
    expect(research).toMatch(/decision load, fit, trust and price/i);
    expect(research).toMatch(/never diagnoses/i);
  });

  it("keeps a weekly decision memo and the hard stop criteria", () => {
    expect(research).toMatch(/continue \| iterate \| pause \| rollback \| stop acquisition/);
    expect(research).toMatch(/no meaningful next-day or weekly reuse after four weeks/i);
    expect(research).toMatch(/duplicate charge or duplicate generation/i);
  });

  it("frames behaviour as use/return/completion and disclaims health-outcome language", () => {
    expect(research).toMatch(/use \/ return \/ completion/i);
    // The doc explicitly says NOT to use adherence/improvement/recovery framing.
    expect(research).toMatch(/never adherence, improvement or recovery/i);
    // No positive health-outcome claim.
    expect(research).not.toMatch(/improves? your health|clinically|proven to/i);
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
