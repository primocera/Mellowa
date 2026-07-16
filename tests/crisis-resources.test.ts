import { describe, it, expect } from "vitest";
import {
  CRISIS_RESOURCES,
  crisisGuidanceFor,
  GENERIC_CRISIS_GUIDANCE,
} from "@/lib/safety/crisis-resources";
import { crisisMessage } from "@/lib/safety/pre-classify";

describe("crisis resource catalog (Prompt 16)", () => {
  it("every entry has a last-verified date and owner", () => {
    for (const r of CRISIS_RESOURCES) {
      expect(r.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.owner.length).toBeGreaterThan(0);
      expect(r.guidance.length).toBeGreaterThan(10);
    }
  });

  it("unknown or missing locale gets the generic fallback, never US 988", () => {
    for (const locale of [null, undefined, "", "xx", "en", "ja-JP", "pt-BR"]) {
      const g = crisisGuidanceFor(locale as string | null);
      expect(g).not.toContain("988");
    }
    expect(crisisGuidanceFor(null)).toBe(GENERIC_CRISIS_GUIDANCE);
  });

  it("Slovenia gets 112 emergency + 116 123 support guidance", () => {
    const g = crisisGuidanceFor("sl-SI");
    expect(g).toContain("112");
    expect(g).toContain("116 123");
  });

  it("EU locales without a dedicated entry still get 112", () => {
    expect(crisisGuidanceFor("fr-FR")).toContain("112");
    expect(crisisGuidanceFor("it-IT")).toContain("112");
  });

  it("crisis messages contain no upsell or plan content", () => {
    for (const category of [
      "self_harm",
      "harm_to_others",
      "eating_disorder",
      "medical_emergency",
    ]) {
      const msg = crisisMessage(category, "sl-SI").toLowerCase();
      expect(msg).not.toMatch(/premium|upgrade|subscribe|trial|plan for today/);
      expect(msg).not.toMatch(/we('|’)ll (monitor|respond|keep this confidential)/);
    }
  });
});
