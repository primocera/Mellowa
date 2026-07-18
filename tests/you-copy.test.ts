import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * You / settings / data / support copy regression (Content Elevation v6, Prompt 13).
 * A coherent control center: preferences shape future plans, data actions are
 * exact, and Help & policies leads to a real support/policy hub.
 */

const you = readFileSync("src/app/(app)/you/page.tsx", "utf8");
const settings = readFileSync("src/app/(app)/settings/page.tsx", "utf8");
const data = readFileSync(
  "src/components/dailyflow/account-data-controls.tsx",
  "utf8"
);
const help = readFileSync("src/app/(app)/help/page.tsx", "utf8");

describe("you & control-center copy (CE-13)", () => {
  it("uses the Your Mellowa heading and four card names", () => {
    expect(you).toContain("Your Mellowa");
    for (const label of [
      "Plan preferences",
      "Membership & billing",
      "Data & privacy",
      "Help & policies",
    ]) {
      expect(you).toContain(label);
    }
    expect(you).not.toContain('label: "You"');
  });

  it("routes Help & policies to a real hub, not just Terms", () => {
    expect(you).toContain('href: "/help"');
    expect(you).not.toContain('href: "/terms"');
  });

  it("settings distinguish future plans from existing history", () => {
    expect(settings).toContain("Shape how Mellowa plans");
    expect(settings.replace(/\s+/g, " ")).toContain(
      "Your existing plans stay as they are."
    );
  });

  it("data controls are exact and plain-language", () => {
    expect(data).toContain("Your data, under your control");
    expect(data.replace(/\s+/g, " ")).toContain(
      "Download a machine-readable copy or permanently delete your account and linked data."
    );
  });

  it("help hub has Get help with the non-emergency note and all policies", () => {
    expect(help).toContain("Get help");
    expect(help.replace(/\s+/g, " ")).toContain(
      "Paid support replies within 2 business days."
    );
    expect(help.replace(/\s+/g, " ")).toContain(
      "Mellowa does not monitor this inbox for emergencies."
    );
    for (const label of ["Terms of Service", "Privacy Policy", "Refund Policy"]) {
      expect(help).toContain(label);
    }
  });
});
