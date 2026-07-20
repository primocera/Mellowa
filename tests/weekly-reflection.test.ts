import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  weeklyFacts,
  carryForwardEffects,
  reflectionToWeeklyHints,
  CARRY_EFFECTS,
  KEEP_OPTIONS,
  LIGHTER_OPTIONS,
  CONSTRAINT_OPTIONS,
} from "@/lib/week/reflection";

/** MW-S06: weekly reflection — deterministic facts + previewed carry-forward. */

const now = new Date("2026-07-19T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400_000).toISOString();

describe("weeklyFacts", () => {
  it("is deterministic and reproducible from user rows", () => {
    const inputs = {
      plans: [
        { created_at: daysAgo(1), plan_mode: "minimum" },
        { created_at: daysAgo(2), plan_mode: "balanced" },
      ],
      feedback: [
        { verdict: "helpful", created_at: daysAgo(1) },
        { verdict: "too_much", created_at: daysAgo(2) },
      ],
      favourites: [{ created_at: daysAgo(3) }],
    };
    const a = weeklyFacts(inputs, now);
    const b = weeklyFacts(inputs, now);
    expect(a).toEqual(b);
    const texts = a.map((f) => f.text).join(" ");
    expect(texts).toContain("2 daily plans");
    expect(texts).toContain("1 item");
    expect(texts).toContain("1 meal");
  });

  it("every statement maps to a recorded input source", () => {
    const facts = weeklyFacts(
      {
        plans: [{ created_at: daysAgo(1), plan_mode: "reset" }],
        feedback: [{ verdict: "too_little_time", created_at: daysAgo(1) }],
        favourites: [],
      },
      now
    );
    for (const f of facts) {
      expect(["plans", "feedback", "favourites", "modes"]).toContain(f.source);
    }
  });

  it("sparse weeks produce no invented insight", () => {
    expect(weeklyFacts({ plans: [], feedback: [], favourites: [] }, now)).toEqual([]);
  });

  it("ignores rows older than 7 days (timezone-safe timestamp math)", () => {
    const facts = weeklyFacts(
      {
        plans: [{ created_at: daysAgo(8), plan_mode: "balanced" }],
        feedback: [],
        favourites: [],
      },
      now
    );
    expect(facts).toEqual([]);
  });

  it("uses only neutral language — no scores, streaks or causal claims", () => {
    const facts = weeklyFacts(
      {
        plans: [
          { created_at: daysAgo(1), plan_mode: "minimum" },
          { created_at: daysAgo(2), plan_mode: "minimum" },
        ],
        feedback: [
          { verdict: "too_much", created_at: daysAgo(1) },
          { verdict: "not_for_me", created_at: daysAgo(2) },
        ],
        favourites: [{ created_at: daysAgo(1) }],
      },
      now
    );
    const all = facts.map((f) => f.text).join(" ");
    expect(all).not.toMatch(/streak|score|because your|mood|improv|consisten|adheren/i);
  });
});

describe("carry-forward", () => {
  it("preview and generation hints use the same canonical mapping", () => {
    const sel = {
      keep: ["meals"],
      lighter: "evenings",
      constraint: "less_time",
    } as Parameters<typeof carryForwardEffects>[0];
    const effects = carryForwardEffects(sel);
    const hints = reflectionToWeeklyHints(sel);
    for (const e of effects) expect(hints).toContain(e);
  });

  it("empty selections carry nothing forward", () => {
    const sel = { keep: [], lighter: null, constraint: null } as Parameters<
      typeof carryForwardEffects
    >[0];
    expect(carryForwardEffects(sel)).toEqual([]);
    expect(reflectionToWeeklyHints(sel)).toBe("");
  });

  it("all answers are closed sets with canonical effects only", () => {
    for (const k of KEEP_OPTIONS.filter((o) => o !== "nothing")) {
      expect(CARRY_EFFECTS[`keep:${k}`]).toBeTruthy();
    }
    for (const l of LIGHTER_OPTIONS.filter((o) => o !== "nothing")) {
      expect(CARRY_EFFECTS[`lighter:${l}`]).toBeTruthy();
    }
    for (const c of CONSTRAINT_OPTIONS.filter((o) => o !== "same_as_usual")) {
      expect(CARRY_EFFECTS[`constraint:${c}`]).toBeTruthy();
    }
    for (const effect of Object.values(CARRY_EFFECTS)) {
      expect(effect).not.toMatch(/mood|health|score|streak/i);
    }
  });
});

describe("MW-S06 surface + route contracts", () => {
  const component = readFileSync("src/components/dailyflow/weekly-reflection.tsx", "utf8");
  const route = readFileSync("src/app/api/week/reflection/route.ts", "utf8");
  const weekly = readFileSync("src/app/api/ai/weekly-plan/route.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/031_mellowa_v8_weekly_reflections.sql",
    "utf8"
  );

  it("previews carry-forward before saving; nothing is generated silently", () => {
    expect(component).toContain("Preview — saving will apply exactly this:");
    expect(component).toMatch(/nothing is generated or changed now/i);
    expect(component).not.toMatch(/fetch\("\/api\/ai\//);
  });

  it("sparse weeks ask preferences directly instead of inventing insights", () => {
    expect(component).toContain("Review plan preferences");
    expect(component).toMatch(/nothing to catch up on/i);
  });

  it("stores only bounded explicit selections; summaries are computed on read", () => {
    expect(route).toContain("weeklyFacts");
    expect(route).toMatch(/z\.enum\(KEEP_OPTIONS\)/);
    expect(migration).toContain("unique (user_id, week_start)");
    expect(migration).toContain("enable row level security");
    // No free-text column for reflections.
    expect(migration).not.toMatch(/\bnotes?\s+text|free_text/i);
  });

  it("next weekly generation applies the reflection as canonical hints only", () => {
    expect(weekly).toContain("reflectionToWeeklyHints");
    expect(weekly).toContain("next_week_plan_created");
  });

  it("no journal content can reach the reflection summary", () => {
    expect(route).not.toMatch(/journal/i);
  });
});
