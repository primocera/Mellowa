/**
 * MW-V18-X04: WCAG 2.2 contrast math, so a palette change that breaks legibility
 * turns the test suite red. Pure and dependency-free.
 *
 * A full accessibility gate also needs axe + Playwright against the running
 * critical journeys (CRITICAL_A11Y_ROUTES below names them); this module is the
 * part that is deterministically checkable without a browser.
 */

/** Parse #rgb or #rrggbb to [r,g,b] 0–255, or null. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().replace(/^#/, "");
  if (m.length === 3) {
    const r = parseInt(m[0] + m[0], 16);
    const g = parseInt(m[1] + m[1], 16);
    const b = parseInt(m[2] + m[2], 16);
    return [r, g, b];
  }
  if (m.length === 6) {
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    if ([r, g, b].every((v) => Number.isFinite(v))) return [r, g, b];
  }
  return null;
}

/** WCAG relative luminance of an sRGB color. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two hex colors (1–21), or null on bad input. */
export function contrastRatio(fg: string, bg: string): number | null {
  const a = parseHex(fg);
  const b = parseHex(bg);
  if (!a || !b) return null;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type TextSize = "normal" | "large";

/** AA thresholds: 4.5:1 normal text, 3:1 large text / UI components. */
export function meetsAA(fg: string, bg: string, size: TextSize = "normal"): boolean {
  const ratio = contrastRatio(fg, bg);
  if (ratio === null) return false;
  return ratio >= (size === "large" ? 3 : 4.5);
}

/** The Mellowa palette (from the product UI rules), for contrast guarding. */
export const MELLOWA_PALETTE = {
  bg: "#FAF7F2",
  bgAlt: "#F8F7F4",
  card: "#FFFFFF",
  text: "#1F2937",
  muted: "#6B7280",
  accent: "#7C9A92",
  accentDark: "#6D8C7D",
  warning: "#FEE2E2",
  success: "#DCFCE7",
} as const;

/** The critical journeys an axe/Playwright a11y gate must cover (X04). */
export const CRITICAL_A11Y_ROUTES = [
  "/", // landing
  "/signup",
  "/login",
  "/today",
  "/pricing",
  "/settings",
  "/you",
] as const;
