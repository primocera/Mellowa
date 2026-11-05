import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bannedLanguageReasons } from "@/lib/ai/quality-checks";

// Regression: four voice-rule patterns once held literal backspace bytes
// (0x08) where `\b` was meant, so they never matched anything.
describe("BANNED_PATTERNS word boundaries", () => {
  it("the source file contains no control characters", () => {
    const src = readFileSync("src/lib/ai/quality-checks.ts", "utf8");
    expect(/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(src)).toBe(false);
  });

  it.each([
    ["You seem anxious today.", "invented emotion"],
    ["Your body needs rest.", "invented bodily claim"],
    ["This lowers cortisol.", "pseudo-clinical claim"],
    ["A gentle detox morning.", "pseudo-clinical claim"],
    ["Guilt-free and clean eating.", "moral food language"],
    ["Enjoy your cheat day.", "moral food language"],
  ])("flags %j", (text, reason) => {
    expect(bannedLanguageReasons({ d: text })).toContain(reason);
  });

  it("does not flag ordinary gentle copy", () => {
    expect(
      bannedLanguageReasons({ d: "A warm bowl of oats and a short walk after lunch." })
    ).toEqual([]);
  });
});
