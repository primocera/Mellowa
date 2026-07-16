import { describe, it, expect } from "vitest";
import {
  minutesOf,
  wakingMinutes,
  validateSleepWindow,
  detectMedicalNutritionSignal,
} from "@/lib/onboarding/validation";

describe("onboarding validation (Prompt 12)", () => {
  it("parses times and rejects invalid ones", () => {
    expect(minutesOf("07:30")).toBe(450);
    expect(minutesOf("23:00")).toBe(1380);
    expect(minutesOf("24:01")).toBeNull();
    expect(minutesOf("nope")).toBeNull();
  });

  it("computes a waking window across midnight", () => {
    expect(wakingMinutes("07:00", "23:00")).toBe(16 * 60);
    // night-shift: wake 22:00, sleep 06:00 → 8h awake
    expect(wakingMinutes("22:00", "06:00")).toBe(8 * 60);
  });

  it("accepts a plausible day and flags implausible ones", () => {
    expect(validateSleepWindow("07:00", "23:00").ok).toBe(true);
    expect(validateSleepWindow("07:00", "07:00").ok).toBe(false); // 24h awake
    expect(validateSleepWindow("07:00", "10:00").ok).toBe(false); // only 3h awake
  });

  it("redirects medical-nutrition needs without false positives", () => {
    expect(detectMedicalNutritionSignal("vegetarian", "nuts", "olives")).toBeNull();
    expect(detectMedicalNutritionSignal("", "diabetes", "")).toBe("diabetes");
    expect(detectMedicalNutritionSignal("meal plan for pregnancy", "", "")).toBe(
      "pregnancy"
    );
  });
});
