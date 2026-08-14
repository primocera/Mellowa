import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  parseHex,
  meetsAA,
  MELLOWA_PALETTE as P,
  CRITICAL_A11Y_ROUTES,
} from "@/lib/a11y/contrast";

/**
 * MW-V18-X04: the design palette meets WCAG 2.2 AA for its intended uses, so a
 * palette regression that harms legibility fails the suite. (The full a11y gate
 * also runs axe/Playwright over CRITICAL_A11Y_ROUTES against the live app.)
 */

describe("contrast math", () => {
  it("computes known ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(parseHex("#7C9A92")).toEqual([124, 154, 146]);
    expect(contrastRatio("nope", "#fff")).toBeNull();
  });
});

describe("body text meets AA (normal 4.5:1)", () => {
  it("main text on card and both backgrounds", () => {
    expect(meetsAA(P.text, P.card)).toBe(true);
    expect(meetsAA(P.text, P.bg)).toBe(true);
    expect(meetsAA(P.text, P.bgAlt)).toBe(true);
  });

  it("muted text on card and background (guards the borderline ~4.52 case)", () => {
    expect(meetsAA(P.muted, P.card)).toBe(true);
    expect(meetsAA(P.muted, P.bg)).toBe(true);
    // Explicit floor so a future darkening of the bg can't silently drop it below AA.
    expect(contrastRatio(P.muted, P.bg)!).toBeGreaterThanOrEqual(4.5);
  });
});

describe("accents are for large text / UI (AA 3:1), not body text", () => {
  it("accent on white and white-on-accent meet the large/UI threshold", () => {
    expect(meetsAA(P.accentDark, P.card, "large")).toBe(true);
    expect(meetsAA(P.card, P.accentDark, "large")).toBe(true);
    expect(meetsAA(P.card, P.accent, "large")).toBe(true);
  });

  it("documents that accents do NOT meet normal-text AA — must not be body text", () => {
    // Encodes the constraint: using an accent for small body copy would fail AA.
    expect(meetsAA(P.accent, P.card, "normal")).toBe(false);
  });
});

describe("critical a11y routes", () => {
  it("covers the key public + authenticated journeys", () => {
    for (const r of ["/", "/signup", "/today", "/pricing", "/settings"]) {
      expect(CRITICAL_A11Y_ROUTES).toContain(r);
    }
  });
});
