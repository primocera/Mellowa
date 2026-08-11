import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Daily check-in copy regression (Content Elevation v6, Prompt 7).
 * Capacity language instead of wellbeing scoring, elevated time/context/mode
 * copy, draft-preserving error messages, and the canonical CTA/loading lines.
 * Internal mode values stay unchanged ("minimum" renders as Lightest version).
 */

const form = readFileSync("src/components/dailyflow/checkin-form.tsx", "utf8");
const page = readFileSync("src/app/(app)/check-in/page.tsx", "utf8");

describe("daily check-in copy (CE-7)", () => {
  it("frames the check-in as a quick day question without an absolute time claim", () => {
    expect(page).toContain("What kind of day is this?");
    expect(page).toContain("About a minute for the essentials. Approximate is enough.");
  });

  it("uses capacity anchors, not wellbeing scores", () => {
    expect(form).toContain("Energy available today");
    expect(form).toContain("Running low");
    expect(form).toContain("Plenty available");
    expect(form).not.toContain("Feeling great");
  });

  it("uses the elevated time and context choices", () => {
    for (const t of [
      "Almost none",
      "About 10 minutes",
      "About 20 minutes",
      "About 30 minutes",
      "Flexible today",
    ]) {
      expect(form).toContain(t);
    }
    expect(form).toContain("How much room do you have for yourself?");
    for (const c of ["Busy", "Low capacity", "Out of routine", "At home", "On the go", "Social day"]) {
      expect(form).toContain(c);
    }
  });

  it("renames Minimum day to Lightest version while keeping the internal value", () => {
    expect(form).toContain('value: "minimum", label: "Lightest version"');
    expect(form).toContain("What should the plan prioritize?");
    expect(form).not.toMatch(/label: "Minimum day"/i);
  });

  it("tells the user their in-progress check-in is still on screen after an error, without claiming device persistence (MW-V17-03)", () => {
    // The draft is kept in memory for this tab only and is never written to
    // long-lived browser storage, so the copy must not promise it was saved to
    // the device or would survive a refresh.
    expect(form).toContain("still here on this screen");
    expect(form).not.toContain("saved on this device");
    expect(form).not.toContain("draft stays saved here");
  });

  it("onboarding-required error tells the user where to finish setup", () => {
    // Skipping onboarding otherwise leaves the user stuck on a generic
    // "finish setup" message with no path to it.
    expect(form).toMatch(/Plan preferences/);
    expect(form).toMatch(/Start onboarding/);
  });

  it("MW-03: sample entitlement is disclosed before generation", () => {
    // Sample-tier users see whether the next plan is the lifetime free sample
    // or the sample is already used, before they submit.
    expect(page).toContain("your one free sample plan");
    expect(page).toMatch(/used your free sample plan/i);
    expect(page).toMatch(/fair-use limits/i);
  });

  it("MW-03: 402/409/429 states are distinct, trial-neutral and draft-preserving", () => {
    // 402 never promises a trial (eligibility is server-decided on Billing).
    expect(form).not.toMatch(/start 3 days free/i);
    expect(form).toMatch(/choose a Premium plan on the Billing page/i);
    // Rate limit and in-progress are distinguishable from a generic failure.
    expect(form).toMatch(/fair-use limits/i);
    expect(form).toMatch(/already being created/i);
  });

  it("MW-V9-02: shows an always-visible pre-generation summary of the setup", () => {
    // The summary reflects the practical choices (mode/time/context) and states
    // where exclusions come from — never energy/stress/mood or the free note.
    expect(form).toContain("This plan will use");
    expect(form).toContain("Plan focus:");
    expect(form).toContain("Time for yourself:");
    expect(form).toMatch(/allergy exclusions come from your saved preferences/i);
    expect(form).toMatch(/Edit anything above before creating the plan/i);
  });

  it("MW-V9-02: fires checkin_started on open, surface only", () => {
    expect(form).toContain('trackClient("checkin_started", { surface: "check_in" })');
  });

  it("uses the canonical CTA, loading and secondary action", () => {
    expect(form).toContain("Shape today&apos;s plan".replace("&apos;", "'"));
    expect(form).toContain("Matching the plan to your time and energy…");
    expect(form).toContain("Give me the lightest version");
    expect(form).toContain("Making the day simpler…");
  });
});
