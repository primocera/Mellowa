import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLIENT_EVENTS, type AppEvent } from "@/lib/analytics/taxonomy";

/** Onboarding first-value activation (Launch v6, Prompt 21). */

const wizard = readFileSync("src/components/dailyflow/onboarding-wizard.tsx", "utf8");
const checkinPage = readFileSync("src/app/(app)/check-in/page.tsx", "utf8");
const checkinForm = readFileSync("src/components/dailyflow/checkin-form.tsx", "utf8");

describe("privacy-safe funnel instrumentation", () => {
  it("onboarding start/complete are client-recordable milestone events", () => {
    for (const e of ["onboarding_started", "onboarding_completed"] as AppEvent[]) {
      expect(CLIENT_EVENTS.has(e), `${e} must be client-recordable`).toBe(true);
    }
  });

  it("fires both milestones with only the enumerated surface property", () => {
    expect(wizard).toContain('trackClient("onboarding_started", { surface: "onboarding" })');
    expect(wizard).toContain('trackClient("onboarding_completed", { surface: "onboarding" })');
  });

  it("never passes a typed field value into an analytics call", () => {
    // No draft.<field> or set(...) values ride along with trackClient.
    const calls = [...wizard.matchAll(/trackClient\([^)]*\)/g)].map((m) => m[0]);
    for (const c of calls) {
      expect(c.includes("draft."), `analytics call leaks a field: ${c}`).toBe(false);
      expect(c.includes("food_preferences") || c.includes("allergies")).toBe(false);
    }
  });
});

describe("time-to-value affordances", () => {
  it("shows an honest time estimate and autosave state", () => {
    expect(wizard).toContain("About 2 minutes");
    expect(wizard).toContain("Saved on this device");
  });

  it("keeps a local resumable draft and clears it on completion", () => {
    expect(wizard).toContain("mellowa.onboarding.draft.v1");
    expect(wizard).toContain("localStorage.removeItem(DRAFT_KEY)");
  });

  it("adds no urgency or completion-pressure copy", () => {
    for (const bad of [/hurry/i, /limited time/i, /don.t miss/i, /act now/i, /last chance/i]) {
      expect(wizard).not.toMatch(bad);
    }
  });
});

describe("safety boundaries surface early, not at the last step", () => {
  it("detects medical-nutrition and severe-allergy signals in the food step", () => {
    expect(wizard).toContain("detectMedicalNutritionSignal");
    expect(wizard).toContain("allergies_severe");
    // Both handled on the food step (index 2), before the final consent step.
    expect(wizard.indexOf("MEDICAL_NUTRITION_MESSAGE")).toBeLessThan(
      wizard.indexOf("Create my first check-in")
    );
  });
});

describe("prefilled handoff to the first check-in", () => {
  it("check-in page seeds baselines from the stored profile", () => {
    expect(checkinPage).toContain("stress_baseline");
    expect(checkinPage).toContain("sleep_quality_baseline");
    expect(checkinPage).toContain("<CheckinForm baseline={baseline} />");
  });

  it("check-in form accepts a baseline seed but lets today's draft win", () => {
    expect(checkinForm).toContain("baseline?: CheckinBaseline");
    expect(checkinForm).toContain("baseline?.stress ?? DEFAULT_DRAFT.stress");
  });
});
