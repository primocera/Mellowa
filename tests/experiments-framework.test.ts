import { describe, expect, it } from "vitest";
import {
  EXPERIMENT_PLANS,
  assignExposed,
  canDeclareWinner,
  planRegistryConsistent,
  noNewUserOverlap,
  type ExperimentPlan,
} from "@/lib/experiments/framework";
import type { ExperimentDef } from "@/lib/experiments/registry";

/**
 * MW-V18-18: bounded experimentation — ramp + staff-only gate exposure, plans
 * are complete and consistent with the registry, the two experiments never
 * overlap for the same cohort, and a winner cannot be declared by peeking.
 */

const def: ExperimentDef = {
  id: "demo",
  namespace: "daily_loop",
  version: 1,
  owner: "product",
  description: "test",
  killSwitchFlag: "FLAG_DEMO",
  expiresAt: "2027-01-01",
  variants: [{ key: "treatment", weight: 100 }],
};
const ON = { FLAG_DEMO: "1" };
const NOW = new Date("2026-08-14T00:00:00Z");

const plan = (over: Partial<ExperimentPlan>): ExperimentPlan => ({
  id: "demo",
  eligible: "x",
  exposurePoint: "x",
  primaryMetric: "x",
  guardrails: ["g"],
  maturityWindowDays: 3,
  analysisStatus: "not_started",
  rampPercent: 0,
  staffOnly: false,
  ...over,
});

describe("exposure is gated by ramp and staff-only", () => {
  it("staff-only mode exposes only staff", () => {
    const p = plan({ staffOnly: true });
    const staff = assignExposed(def, p, "u1", { now: NOW, env: ON, isStaff: true });
    const normal = assignExposed(def, p, "u1", { now: NOW, env: ON, isStaff: false });
    expect(staff.exposed).toBe(true);
    expect(normal.exposed).toBe(false);
    expect(normal.variant).toBe("control"); // not exposed → control
  });

  it("a 0% ramp exposes nobody; 100% exposes everyone eligible", () => {
    const zero = plan({ rampPercent: 0 });
    const full = plan({ rampPercent: 100 });
    let exposedZero = 0;
    let exposedFull = 0;
    for (let i = 0; i < 200; i++) {
      if (assignExposed(def, zero, `u${i}`, { now: NOW, env: ON }).exposed) exposedZero++;
      if (assignExposed(def, full, `u${i}`, { now: NOW, env: ON }).exposed) exposedFull++;
    }
    expect(exposedZero).toBe(0);
    expect(exposedFull).toBe(200);
  });

  it("a killed experiment never exposes (rollback = flag flip)", () => {
    const a = assignExposed(def, plan({ rampPercent: 100 }), "u1", { now: NOW, env: {} });
    expect(a.exposed).toBe(false);
    expect(a.live).toBe(false);
  });
});

describe("no-peeking winner guard", () => {
  it("refuses unless analysis is predeclared ready, mature and guardrails clear", () => {
    expect(canDeclareWinner({ plan: plan({ analysisStatus: "collecting" }), cohortMature: true, guardrailsClear: true }))
      .toEqual({ canDeclare: false, reason: "not_ready" });
    expect(canDeclareWinner({ plan: plan({ analysisStatus: "ready" }), cohortMature: false, guardrailsClear: true }))
      .toEqual({ canDeclare: false, reason: "immature" });
    expect(canDeclareWinner({ plan: plan({ analysisStatus: "ready" }), cohortMature: true, guardrailsClear: false }))
      .toEqual({ canDeclare: false, reason: "guardrail_breached" });
    expect(canDeclareWinner({ plan: plan({ analysisStatus: "ready" }), cohortMature: true, guardrailsClear: true }))
      .toEqual({ canDeclare: true });
  });
});

describe("plan completeness + registry consistency", () => {
  it("only two experiments, each with a complete plan", () => {
    expect(Object.keys(EXPERIMENT_PLANS).sort()).toEqual(["first_session", "repair_preview"]);
    for (const p of Object.values(EXPERIMENT_PLANS)) {
      expect(p.eligible && p.exposurePoint && p.primaryMetric).toBeTruthy();
      expect(p.guardrails.length).toBeGreaterThan(0);
      expect(p.maturityWindowDays).toBeGreaterThan(0);
      // Both start safe: staff-only and 0% ramp.
      expect(p.staffOnly).toBe(true);
      expect(p.rampPercent).toBe(0);
    }
  });

  it("every plan maps to a real product experiment in the registry", () => {
    expect(planRegistryConsistent()).toBe(true);
  });

  it("the two experiments never overlap for the same new-user cohort", () => {
    expect(noNewUserOverlap(NOW, { FLAG_FIRST_SESSION_EXPERIMENT: "1", FLAG_REPAIR_PREVIEW_EXPERIMENT: "1" })).toBe(true);
  });
});
