import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  nextAction,
  phaseForMinutes,
  NOW_SELECTOR_VERSION,
  type NowPlanInput,
} from "@/lib/today/next-action";

/**
 * MW-S01: the Now selector is deterministic and pure. It only ever surfaces
 * items that exist on the saved plan, respects completion/deferral state and
 * never invents times or calls AI.
 */

const fullPlan: NowPlanInput = {
  plan_mode: "balanced",
  meal_cards: [
    { meal_type: "breakfast", title: "Yogurt bowl", total_time_minutes: 5 },
    { meal_type: "lunch", title: "Grain salad", total_time_minutes: 15 },
    { meal_type: "dinner", title: "Sheet-pan veg", total_time_minutes: 25 },
  ],
  movement_plan: { title: "Short walk", duration_minutes: 10 },
  breathing_exercise: { name: "Box breathing", duration_minutes: 3 },
  focus_plan: { main_task: "Finish the report draft" },
  evening_routine: { steps: ["Dim lights", "Phone away"] },
  habit_focus: { habit: "Glass of water after waking" },
};

const MORNING = 8 * 60;
const MIDDAY = 12 * 60;
const LATER = 16 * 60;
const EVENING = 20 * 60;

describe("phaseForMinutes", () => {
  it("maps local minutes to broad phases with stable boundaries", () => {
    expect(phaseForMinutes(0)).toBe("morning");
    expect(phaseForMinutes(10 * 60 + 59)).toBe("morning");
    expect(phaseForMinutes(11 * 60)).toBe("midday");
    expect(phaseForMinutes(14 * 60 + 59)).toBe("midday");
    expect(phaseForMinutes(15 * 60)).toBe("later");
    expect(phaseForMinutes(18 * 60)).toBe("evening");
    expect(phaseForMinutes(23 * 60 + 59)).toBe("evening");
  });

  it("normalizes out-of-range minutes instead of throwing (timezone edge)", () => {
    expect(phaseForMinutes(-60)).toBe("evening"); // 23:00 previous wrap
    expect(phaseForMinutes(24 * 60 + 60)).toBe("morning");
  });
});

describe("nextAction selection", () => {
  it("is deterministic: same inputs, same action", () => {
    const a = nextAction(fullPlan, [], MORNING);
    const b = nextAction(fullPlan, [], MORNING);
    expect(a.action).toEqual(b.action);
  });

  it("picks the phase-appropriate meal first", () => {
    expect(nextAction(fullPlan, [], MORNING).action?.key).toBe("meal:breakfast");
    expect(nextAction(fullPlan, [], MIDDAY).action?.key).toBe("meal:lunch");
    expect(nextAction(fullPlan, [], EVENING).action?.key).toBe("meal:dinner");
  });

  it("skips completed items and moves to the next rule", () => {
    const sel = nextAction(fullPlan, ["meal:breakfast", "habit"], MORNING);
    expect(sel.action?.key).toBe("movement");
  });

  it("deferral removes an item from selection but keeps it on the plan", () => {
    const sel = nextAction(fullPlan, [], MORNING, ["meal:breakfast"]);
    expect(sel.action?.key).not.toBe("meal:breakfast");
    expect(sel.deferred).toBe(1);
  });

  it("in minimum/reset modes the calm reset outranks movement and focus is absent", () => {
    const minimal: NowPlanInput = {
      plan_mode: "minimum",
      meal_cards: [{ meal_type: "breakfast", title: "Toast", total_time_minutes: 5 }],
      movement_plan: { title: "Stretch", duration_minutes: 5 },
      breathing_exercise: { name: "Slow breaths", duration_minutes: 2 },
      focus_plan: { main_task: "Should never appear" },
    };
    const sel = nextAction(minimal, ["meal:breakfast"], MORNING);
    expect(sel.action?.key).toBe("breathing");
    const keys: string[] = [];
    let done: string[] = ["meal:breakfast"];
    for (;;) {
      const s = nextAction(minimal, done, MORNING);
      if (!s.action) break;
      keys.push(s.action.key);
      done = [...done, s.action.key];
    }
    expect(keys).not.toContain("focus");
  });

  it("returns no action and allDone when every item is completed", () => {
    const done = [
      "meal:breakfast",
      "meal:lunch",
      "meal:dinner",
      "movement",
      "breathing",
      "habit",
      "focus",
      "evening",
    ];
    const sel = nextAction(fullPlan, done, LATER);
    expect(sel.action).toBeNull();
    expect(sel.allDone).toBe(true);
  });

  it("all-deferred yields a neutral no-action state, not pressure on a deferred item", () => {
    const allKeys = [
      "meal:breakfast",
      "meal:lunch",
      "meal:dinner",
      "movement",
      "breathing",
      "habit",
      "focus",
      "evening",
    ];
    const sel = nextAction(fullPlan, [], MIDDAY, allKeys);
    expect(sel.action).toBeNull();
    expect(sel.allDone).toBe(false);
    expect(sel.deferred).toBe(allKeys.length);
  });

  it("MW-V9-03: the ruleset is versioned", () => {
    expect(typeof NOW_SELECTOR_VERSION).toBe("string");
    expect(NOW_SELECTOR_VERSION.length).toBeGreaterThan(0);
  });

  it("MW-V9-03: always returns at most one action across every phase and progressive completion", () => {
    for (const minutes of [MORNING, MIDDAY, LATER, EVENING, 0, 23 * 60 + 59]) {
      let done: string[] = [];
      // Walk the whole plan to exhaustion; each step must yield 0 or 1 action.
      for (let guard = 0; guard < 20; guard++) {
        const sel = nextAction(fullPlan, done, minutes);
        // NowSelection.action is a single item or null — never a list.
        expect(sel.action === null || typeof sel.action.key === "string").toBe(true);
        if (!sel.action) break;
        done = [...done, sel.action.key];
      }
    }
  });

  it("handles an empty plan without inventing anything", () => {
    const sel = nextAction({}, [], MIDDAY);
    expect(sel.action).toBeNull();
    expect(sel.allDone).toBe(false);
    expect(sel.remaining).toBe(0);
  });

  it("duration comes only from stored plan data", () => {
    const sel = nextAction(fullPlan, [], MORNING);
    expect(sel.action?.durationMinutes).toBe(5);
    const noDuration = nextAction(
      { habit_focus: { habit: "Water" } },
      [],
      MORNING
    );
    expect(noDuration.action?.durationMinutes).toBeUndefined();
  });
});

describe("MW-S01 Now view content contract", () => {
  const src = readFileSync("src/components/dailyflow/today-plan-v2.tsx", "utf8");
  const selector = readFileSync("src/lib/today/next-action.ts", "utf8");

  it("offers Done, Not now and View full plan", () => {
    expect(src).toContain("Done");
    expect(src).toContain("Not now");
    expect(src).toContain("View full plan");
  });

  it("uses only bounded defer reasons and no AI call in the Now flow", () => {
    for (const code of ["no_time", "too_much", "not_relevant", "already_handled"]) {
      expect(src).toContain(code);
    }
    expect(selector).not.toMatch(/fetch\(|anthropic|generate/i);
  });

  it("all-done state is neutral — no celebration, score or streak", () => {
    expect(src).toContain("Nothing else is asked of you");
    expect(src).not.toMatch(/streak|score|congratulations|amazing|crushed/i);
  });

  it("never implies the action is medically necessary or optimal", () => {
    expect(selector).not.toMatch(/should|must|optimal|best for your health/i);
    expect(src).toMatch(/One step at a time is enough/);
  });

  it("save failure keeps copy honest and retryable", () => {
    // MW-V10-03: the message now states the resulting state explicitly, because
    // "your plan is unchanged" was ambiguous about whether the tap took effect.
    expect(src).toMatch(/it isn't marked done/i);
    expect(src).toMatch(/it's still marked done/i);
    expect(src).toMatch(/nothing else about your plan changed/i);
    expect(src).toMatch(/Tap it again to retry/i);
  });

  it("MW-V9-03: offers a short undo right after Done on the Now card", () => {
    expect(src).toContain("Marked done.");
    // MW-V10-03: the confirmation is set from the server's confirmed response,
    // not optimistically at click time.
    expect(src).toContain('if (data.done && source === "now") setJustDone(key)');
    // Undo unmarks by toggling the same key back.
    expect(src).toMatch(/toggleDone\(justDone, "now"\)/);
  });
});
