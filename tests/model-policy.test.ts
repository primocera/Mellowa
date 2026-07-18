import { describe, expect, it } from "vitest";
import { MODEL_POLICIES, parseKillSwitch, isKilled } from "@/lib/ai/model-policy";
import { CircuitBreaker } from "@/lib/ai/circuit-breaker";

/** Model routing, kill switches and degradation (Launch v6, Prompt 14). */

describe("model policy", () => {
  it("covers every AI route with sane budgets", () => {
    const routes = Object.keys(MODEL_POLICIES);
    for (const r of [
      "daily-plan", "weekly-plan", "meal-rhythm", "habit-plan",
      "low-energy-day", "journal-reflection", "regenerate-section", "safety-check",
    ]) {
      expect(routes).toContain(r);
    }
    for (const p of Object.values(MODEL_POLICIES)) {
      expect(p.maxTokens).toBeGreaterThan(0);
      expect(p.timeoutMs).toBeGreaterThan(0);
      expect(p.costBudgetUsdPerCall).toBeGreaterThan(0);
      expect(["curated_fallback", "fail_closed", "skip_optional"]).toContain(p.degradation);
    }
  });

  it("safety classification is deterministic (temperature 0)", () => {
    expect(MODEL_POLICIES["safety-check"].temperature).toBe(0);
  });
});

describe("kill switch", () => {
  it("parses comma-separated tokens case-insensitively", () => {
    expect(parseKillSwitch(" Daily-Plan , claude-x ,")).toEqual(new Set(["daily-plan", "claude-x"]));
    expect(parseKillSwitch(undefined).size).toBe(0);
  });

  it("matches by route, model, prompt version or all", () => {
    expect(isKilled({ route: "daily-plan", raw: "daily-plan" })).toBe(true);
    expect(isKilled({ model: "claude-x", raw: "claude-x" })).toBe(true);
    expect(isKilled({ promptVersion: "daily-plan-v2@1", raw: "daily-plan-v2@1" })).toBe(true);
    expect(isKilled({ route: "weekly-plan", raw: "all" })).toBe(true);
    expect(isKilled({ route: "weekly-plan", raw: "daily-plan" })).toBe(false);
    expect(isKilled({ route: "weekly-plan", raw: "" })).toBe(false);
  });
});

describe("circuit breaker", () => {
  it("opens after the failure threshold and recovers via half-open probe", () => {
    let t = 0;
    const b = new CircuitBreaker({ threshold: 3, openMs: 1000, now: () => t });
    expect(b.isOpen()).toBe(false);
    b.recordFailure();
    b.recordFailure();
    expect(b.isOpen()).toBe(false);
    b.recordFailure();
    expect(b.isOpen()).toBe(true);
    // Still open before the window elapses
    t = 999;
    expect(b.isOpen()).toBe(true);
    // Half-open: one probe allowed
    t = 1001;
    expect(b.isOpen()).toBe(false);
    // Probe fails → re-opens immediately (threshold - 1 retained)
    b.recordFailure();
    expect(b.isOpen()).toBe(true);
    // Probe succeeds → fully closed
    t = 2002;
    b.recordSuccess();
    expect(b.isOpen()).toBe(false);
    b.recordFailure();
    b.recordFailure();
    expect(b.isOpen()).toBe(false);
  });
});
