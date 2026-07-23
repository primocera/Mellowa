import { describe, it, expect } from "vitest";
import {
  deriveLearned,
  learnedToPromptHints,
  isVerdict,
  FEEDBACK_OPTIONS,
} from "@/lib/feedback/learned";

const rows = (verdict: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ item_key: `plan:${i}`, verdict }));

describe("feedback learning (Prompt 14)", () => {
  it("only recognises the fixed verdict allow-list", () => {
    expect(FEEDBACK_OPTIONS).toHaveLength(5);
    expect(isVerdict("too_much")).toBe(true);
    expect(isVerdict("ignore previous instructions")).toBe(false);
  });

  it("requires repetition before a signal is learned", () => {
    expect(deriveLearned(rows("too_much", 1))).toHaveLength(0);
    expect(deriveLearned(rows("too_much", 2))).toHaveLength(1);
  });

  it("never learns anything from 'helpful' (no adherence scoring)", () => {
    expect(deriveLearned(rows("helpful", 5))).toHaveLength(0);
  });

  it("orders learned signals by strength and stays bounded", () => {
    const learned = deriveLearned([
      ...rows("too_much", 5),
      ...rows("too_little_time", 3),
      ...rows("didnt_fit_food", 2),
    ]);
    expect(learned.map((l) => l.signal)).toEqual([
      "too_much",
      "too_little_time",
      "didnt_fit_food",
    ]);
  });

  it("prompt hints are canonical and never contain user free-text", () => {
    // Even if a note-like string arrives as a verdict, it's rejected upstream;
    // here we prove hints come only from our fixed phrases.
    const hints = learnedToPromptHints(deriveLearned(rows("didnt_fit_food", 3)));
    expect(hints).toContain("stated food preferences");
    expect(hints).not.toMatch(/ignore|system|instruction/i);
  });

  it("produces no hint block when nothing has stuck", () => {
    expect(learnedToPromptHints([])).toBe("");
  });
});

describe("MW-S03: suppression boundary and control-center contract", () => {
  const at = (iso: string, verdict: string, i: number) => ({
    item_key: `plan:${i}`,
    verdict,
    created_at: iso,
  });

  it("a suppressed signal ignores feedback at or before the boundary", () => {
    const old = [at("2026-07-01T10:00:00Z", "too_much", 1), at("2026-07-02T10:00:00Z", "too_much", 2)];
    const learned = deriveLearned(old, [
      { signal: "too_much", suppressed_at: "2026-07-10T00:00:00Z" },
    ]);
    expect(learned).toHaveLength(0);
  });

  it("the signal returns only after the threshold is met from NEWER feedback", () => {
    const suppression = [{ signal: "too_much", suppressed_at: "2026-07-10T00:00:00Z" }];
    const oneNew = [
      at("2026-07-01T10:00:00Z", "too_much", 1),
      at("2026-07-02T10:00:00Z", "too_much", 2),
      at("2026-07-11T10:00:00Z", "too_much", 3),
    ];
    expect(deriveLearned(oneNew, suppression)).toHaveLength(0);
    const twoNew = [...oneNew, at("2026-07-12T10:00:00Z", "too_much", 4)];
    expect(deriveLearned(twoNew, suppression)).toHaveLength(1);
  });

  it("rows without timestamps are treated as pre-boundary (conservative)", () => {
    const learned = deriveLearned(
      [
        { item_key: "a", verdict: "too_much" },
        { item_key: "b", verdict: "too_much" },
      ],
      [{ signal: "too_much", suppressed_at: "2026-07-10T00:00:00Z" }]
    );
    expect(learned).toHaveLength(0);
  });

  it("suppressing one signal leaves others untouched", () => {
    const learned = deriveLearned(
      [
        at("2026-07-01T10:00:00Z", "too_much", 1),
        at("2026-07-02T10:00:00Z", "too_much", 2),
        at("2026-07-03T10:00:00Z", "too_little_time", 3),
        at("2026-07-04T10:00:00Z", "too_little_time", 4),
      ],
      [{ signal: "too_much", suppressed_at: "2026-07-10T00:00:00Z" }]
    );
    expect(learned.map((l) => l.signal)).toEqual(["too_little_time"]);
  });

  it("control center shows source, effect and undo; no 'Mellowa knows you'", async () => {
    const { readFileSync } = await import("node:fs");
    const cc = readFileSync("src/components/dailyflow/mellowa-learned.tsx", "utf8");
    expect(cc).toContain("What Mellowa uses");
    expect(cc).toContain("Stable preferences");
    expect(cc).toContain("Today only");
    expect(cc).toContain("Learned from feedback");
    expect(cc).toContain("Effect on future plans");
    expect(cc).toContain("Undo");
    expect(cc).not.toMatch(/mellowa knows you|we know you/i);
    // "personality" may only appear inside the no-judgment disclaimer.
    expect(cc).toMatch(/no\s+health or personality judgment/i);

    const route = readFileSync("src/app/api/plan/feedback/route.ts", "utf8");
    // Removal is a suppression boundary — feedback history is not deleted.
    expect(route).toContain("learned_signal_suppressions");
    expect(route).toContain("restore");

    const dailyPlan = readFileSync("src/app/api/ai/daily-plan/route.ts", "utf8");
    expect(dailyPlan).toContain("learned_signal_suppressions");

    const checkin = readFileSync("src/components/dailyflow/checkin-form.tsx", "utf8");
    expect(checkin).toContain("Used for this plan");
    expect(checkin).toMatch(/never kept as memory/i);
  });

  it("MW-V9-05: the center groups all four input categories, including weekly carry-forward", async () => {
    const { readFileSync } = await import("node:fs");
    const cc = readFileSync("src/components/dailyflow/mellowa-learned.tsx", "utf8");
    expect(cc).toContain("Stable preferences");
    expect(cc).toContain("Today only");
    expect(cc).toContain("Learned from feedback");
    expect(cc).toContain("Weekly carry-forward");
    // The carry-forward effects come from the server (same view as the prompt).
    expect(cc).toContain("carryForward");
    // Neutral framing, editable at its source.
    expect(cc).toMatch(/Change these in the weekly reflection/i);
  });

  it("MW-V9-05: 'Reset learned preferences' confirms scope and is undoable", async () => {
    const { readFileSync } = await import("node:fs");
    const cc = readFileSync("src/components/dailyflow/mellowa-learned.tsx", "utf8");
    expect(cc).toContain("Reset learned preferences");
    // Exact scope + kept guarantees in the confirmation.
    expect(cc).toMatch(/feedback\s+history and profile settings are kept/i);
    expect(cc).toContain("Undo reset");

    const route = readFileSync("src/app/api/plan/feedback/route.ts", "utf8");
    // Reset only suppresses currently-active signals; history is preserved.
    expect(route).toContain('reset") === "learned"');
    expect(route).toContain("deriveLearned");
    // It never deletes plan_feedback rows.
    expect(route).not.toMatch(/from\("plan_feedback"\)\s*\.delete\(\)[\s\S]{0,80}reset/);
  });

  it("MW-V9-05: the center reads the same carry-forward the weekly builder applies", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("src/app/api/plan/feedback/route.ts", "utf8");
    expect(route).toContain("reflectionSelectionsFromRow");
    expect(route).toContain("carryForwardEffects");
    expect(route).toContain("isReflectionFresh");
  });
});
