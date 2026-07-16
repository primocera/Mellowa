import { describe, it, expect, vi, beforeEach } from "vitest";
import { preClassifySafety, crisisMessage } from "@/lib/safety/pre-classify";

// ---- checkInputSafety with mocked provider + db (fail-closed behavior) ----

const generateMock = vi.fn();
vi.mock("@/lib/ai/generate-json", () => ({
  generateStructuredJson: (...args: unknown[]) => generateMock(...args),
}));

const insertMock = vi.fn(async (_row: unknown) => ({ error: null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ insert: insertMock }),
  }),
}));

import { checkInputSafety } from "@/lib/safety/check-input";

beforeEach(() => {
  generateMock.mockReset();
  insertMock.mockClear();
});

// ---- Deterministic matrix (Prompt 5) ----

const BLOCKED_CASES: Record<string, string[]> = {
  self_harm: [
    "I want to kill myself",
    "i've been thinking about suicide",
    "I keep cutting myself at night",
    "there's no reason to live anymore",
    "I dont want to be alive",
  ],
  harm_to_others: [
    "some days I want to hurt someone",
    "I'm going to kill him",
  ],
  eating_disorder: [
    "I purge after dinner",
    "I make myself throw up after eating",
    "I've been starving myself all week",
    "planning to eat 500 calories a day",
    "no food for 5 days should reset me",
  ],
  medical_emergency: [
    "I have chest pain and feel dizzy",
    "I can't breathe properly since an hour",
    "I think my dad is having a heart attack",
    "took too many pills, maybe an overdose",
  ],
  medical_nutrition: [
    "meal plan for my diabetes please",
    "I'm on dialysis, what should I eat",
    "chemo diet ideas",
    "I have celiac disease",
  ],
  pregnancy: [
    "I'm pregnant, plan my meals",
    "breastfeeding and unsure what to eat",
    "postpartum meal ideas",
  ],
  substance_misuse: [
    "trying to quit drinking cold turkey",
    "having withdrawal symptoms since yesterday",
  ],
};

const BENIGN_CASES = [
  "I'm dying to sleep in this weekend",
  "this deadline is killing me",
  "I could eat a horse today",
  "feeling low energy after a stressful meeting",
  "want lighter meals this week",
  "my kids exhaust me but we had fun",
  "skipped breakfast today, felt rushed",
];

describe("deterministic safety matrix (Prompt 5)", () => {
  for (const [category, cases] of Object.entries(BLOCKED_CASES)) {
    it(`blocks ${category}`, () => {
      for (const text of cases) {
        const res = preClassifySafety(text);
        expect(res, `should block: "${text}"`).not.toBeNull();
        expect(res!.should_block_generation).toBe(true);
        expect(res!.risk_types).toContain(category);
      }
    });
  }

  it("does not block benign everyday phrases", () => {
    for (const text of BENIGN_CASES) {
      expect(preClassifySafety(text), `should pass: "${text}"`).toBeNull();
    }
  });

  it("defers ambiguous/indirect language to the AI classifier", () => {
    // Indirect phrasing is the AI classifier's job — pre-filter must defer,
    // never wave through as safe.
    expect(preClassifySafety("everyone would be better off without me")).toBeNull();
  });
});

describe("crisis messaging (Prompt 5/16)", () => {
  it("never assumes a US helpline for unknown locales", () => {
    for (const locale of [null, undefined, "xx", "de-DE", "sl-SI", ""]) {
      const msg = crisisMessage("self_harm", locale as string | null);
      expect(msg).not.toContain("988");
    }
  });

  it("uses region resources when known", () => {
    expect(crisisMessage("self_harm", "en-US")).toContain("988");
    expect(crisisMessage("self_harm", "en-GB")).toContain("116 123");
  });

  it("medical emergencies are not answered with wellness content", () => {
    const msg = crisisMessage("medical_emergency", "en-US");
    expect(msg.toLowerCase()).toContain("emergency services");
    expect(msg.toLowerCase()).not.toContain("breath");
  });
});

describe("checkInputSafety fail-closed (Prompt 5)", () => {
  it("blocks generation when the classifier throws", async () => {
    generateMock.mockRejectedValueOnce(new Error("provider down"));
    const res = await checkInputSafety("u1", "daily-plan", "some ambiguous text");
    expect(res.should_block_generation).toBe(true);
    expect(res.is_safe).toBe(false);
  });

  it("blocks generation on classifier schema mismatch", async () => {
    generateMock.mockRejectedValueOnce(new Error("zod parse failed"));
    const res = await checkInputSafety("u1", "check-in", "unusual wording");
    expect(res.should_block_generation).toBe(true);
  });

  it("passes safe input through when the classifier approves", async () => {
    generateMock.mockResolvedValueOnce({
      is_safe: true,
      risk_level: "none",
      risk_types: [],
      should_block_generation: false,
      user_message: "",
      internal_reason: "ok",
    });
    const res = await checkInputSafety("u1", "daily-plan", "busy day, short on time");
    expect(res.should_block_generation).toBe(false);
  });

  it("stores only a short redacted excerpt, never full crisis input", async () => {
    const long = "I want to kill myself " + "x".repeat(500);
    await checkInputSafety("u1", "daily-plan", long);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0] as unknown as {
      user_input_excerpt: string;
    };
    expect(row.user_input_excerpt.length).toBeLessThanOrEqual(120);
  });

  it("empty input is safe and makes no provider call", async () => {
    const res = await checkInputSafety("u1", "daily-plan", "   ");
    expect(res.is_safe).toBe(true);
    expect(generateMock).not.toHaveBeenCalled();
  });
});
