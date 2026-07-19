import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-07: Journal transparency contract. The disclosure that saving sends the
 * entry for an AI-generated reflection must appear BEFORE submission, the
 * returned reflection must be labeled as AI-generated, and save failures must
 * state plainly that nothing was saved.
 */

const view = readFileSync("src/components/dailyflow/journal-view.tsx", "utf8");
const route = readFileSync(
  "src/app/api/ai/journal-reflection/route.ts",
  "utf8"
);

describe("journal disclosure (MW-07)", () => {
  it("discloses AI processing and non-monitoring before the save button", () => {
    const disclosure = view.indexOf("sends this entry to our AI provider");
    const saveButton = view.indexOf("Save entry");
    expect(disclosure).toBeGreaterThan(-1);
    expect(saveButton).toBeGreaterThan(disclosure);
    expect(view).toMatch(/not monitored/i);
    expect(view).toMatch(/isn&rsquo;t therapy or crisis support/i);
  });

  it("labels the returned reflection as AI-generated", () => {
    expect(view).toContain("AI-generated reflection");
    expect(view).toMatch(/keep only what feels useful/i);
  });

  it("save failure states plainly that the entry did not save", () => {
    expect(view).toMatch(/didn't save\. Your text is still here/i);
    expect(view).not.toMatch(/your words matter/i);
  });

  it("route runs safety before saving and never upsells on blocked input", () => {
    const safetyIdx = route.indexOf("checkInputSafety");
    const saveIdx = route.indexOf("journal_entries");
    const premiumIdx = route.indexOf("isPremium");
    expect(safetyIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(safetyIdx);
    expect(premiumIdx).toBeGreaterThan(saveIdx);
    // The blocked branch returns only the safety message — no billing copy.
    expect(route).toMatch(/blocked: true, user_message: safety\.user_message/);
  });
});
