import { describe, expect, it } from "vitest";
import {
  buildPreferences,
  applyCurrentContext,
  PREFERENCE_DECAY_DAYS,
  PREFERENCE_MODEL_VERSION,
} from "@/lib/feedback/preferences";
import type { FeedbackRow } from "@/lib/feedback/learned";

/**
 * MW-V18-12: the preference model is versioned, inferred-only, carries
 * source/confidence/expiry/why, decays when unused, honours removal boundaries,
 * and yields to a fresh contradicting check-in. Values are canonical slugs,
 * never free text.
 */

const NOW = new Date("2026-08-14T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const fb = (verdict: string, ago: number): FeedbackRow => ({
  item_key: "k",
  verdict,
  created_at: daysAgo(ago),
});

describe("versioned, transparent preference model", () => {
  it("builds an inferred preference with confidence, timestamps, expiry and why", () => {
    const prefs = buildPreferences([fb("too_much", 3), fb("too_much", 1)], [], NOW);
    expect(prefs).toHaveLength(1);
    const p = prefs[0];
    expect(p.signal).toBe("too_much");
    expect(p.category).toBe("plan_load");
    expect(p.source).toBe("inferred");
    expect(p.value).toBe("too_much"); // canonical slug, never free text
    expect(p.count).toBe(2);
    expect(p.confidence).toBeGreaterThan(0);
    expect(p.whyUsed).toMatch(/keep the plan lighter/);
    expect(PREFERENCE_MODEL_VERSION).toBe("m12.1");
  });

  it("requires at least two observations", () => {
    expect(buildPreferences([fb("too_much", 1)], [], NOW)).toHaveLength(0);
  });
});

describe("decay: unused inferred preferences expire", () => {
  it("drops a preference whose newest feedback is older than the decay window", () => {
    const old = PREFERENCE_DECAY_DAYS + 5;
    const prefs = buildPreferences([fb("too_much", old + 1), fb("too_much", old)], [], NOW);
    expect(prefs).toHaveLength(0);
  });

  it("keeps a preference reinforced within the window", () => {
    const prefs = buildPreferences(
      [fb("too_much", PREFERENCE_DECAY_DAYS + 10), fb("too_much", 2)],
      [],
      NOW
    );
    expect(prefs).toHaveLength(1);
  });
});

describe("removal boundary (free Undo) is honoured", () => {
  it("feedback at or before a suppression no longer counts", () => {
    const prefs = buildPreferences(
      [fb("too_much", 10), fb("too_much", 8)],
      [{ signal: "too_much", suppressed_at: daysAgo(5) }],
      NOW
    );
    expect(prefs).toHaveLength(0); // both observations pre-date the removal
  });
});

describe("conflict resolution with today's check-in", () => {
  it("a contradicting today signal removes the learned preference for today", () => {
    const prefs = buildPreferences([fb("too_much", 3), fb("too_much", 1)], [], NOW);
    const applied = applyCurrentContext(prefs, ["too_much"]);
    expect(applied).toHaveLength(0);
  });
});
