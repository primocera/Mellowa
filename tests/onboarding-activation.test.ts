import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLIENT_EVENTS,
  SERVER_AUTHORITATIVE_EVENTS,
  type AppEvent,
} from "@/lib/analytics/taxonomy";

/** Onboarding first-value activation (Launch v6, Prompt 21). */

const wizard = readFileSync("src/components/dailyflow/onboarding-wizard.tsx", "utf8");
const checkinPage = readFileSync("src/app/(app)/check-in/page.tsx", "utf8");
const checkinForm = readFileSync("src/components/dailyflow/checkin-form.tsx", "utf8");

describe("privacy-safe funnel instrumentation", () => {
  it("onboarding_started is a client view; onboarding_completed is server-authoritative (MW-95-03)", () => {
    expect(CLIENT_EVENTS.has("onboarding_started" as AppEvent)).toBe(true);
    // A browser must not be able to assert activation.
    expect(SERVER_AUTHORITATIVE_EVENTS.has("onboarding_completed" as AppEvent)).toBe(true);
    expect(CLIENT_EVENTS.has("onboarding_completed" as AppEvent)).toBe(false);
  });

  it("fires the start milestone client-side and asks the server to record completion", () => {
    expect(wizard).toContain('trackClient("onboarding_started", { surface: "onboarding" })');
    // Completion is a server call, not a client claim.
    expect(wizard).toContain('fetch("/api/onboarding/complete", { method: "POST" })');
    expect(wizard).not.toContain('trackClient("onboarding_completed"');
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
  it("shows an honest time estimate and resume state", () => {
    expect(wizard).toContain("About 2 minutes");
    // MW-V17-06: honest copy — answers live in the tab and may need re-entry after
    // a refresh; nothing implies the answers themselves are kept on the device.
    expect(wizard).toContain("Your answers stay in this tab");
    expect(wizard).not.toContain("kept on this device");
    expect(wizard).not.toContain("Saved on this device");
  });

  it("persists only a non-sensitive, schema-versioned step hint and purges the legacy draft", () => {
    // MW-95-05 / MW-V17-06: only the step index (with schema version + timestamp)
    // is written; sensitive answers are never serialized, the retired full-draft
    // key is removed, and resume clamps to the first incomplete step.
    expect(wizard).toContain("JSON.stringify({ v: PROGRESS_SCHEMA, step, ts: Date.now() })");
    expect(wizard).toContain("firstIncompleteStep(INITIAL)");
    expect(wizard).toContain("localStorage.removeItem(LEGACY_DRAFT_KEY)");
    // The old full-draft write must be gone entirely.
    expect(wizard).not.toContain("JSON.stringify(draft)");
    // No sensitive field name may appear in any localStorage.setItem call.
    const setItemCalls = [...wizard.matchAll(/localStorage\.setItem\([^;]*\)/g)].map((m) => m[0]);
    for (const call of setItemCalls) {
      for (const field of [
        "allergies",
        "allergies_severe",
        "stress_baseline",
        "sleep_quality_baseline",
        "energy_baseline",
        "disliked_ingredients",
        "work_schedule",
        "food_preferences",
      ]) {
        expect(call.includes(field), `setItem leaks ${field}: ${call}`).toBe(false);
      }
    }
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
