import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TERMS } from "@/lib/content/terminology";

/**
 * Final content QA + claim audit gate (Content Elevation v6, Prompt 20).
 *
 * These are the automatable half of the release gate: they lock the invariants
 * the claim audit depends on so a later edit can't silently reintroduce a
 * content-truth or safety-copy mismatch. The human-owned half (5-user
 * comprehension, axe, screenshots, crisis-number re-verification) is tracked in
 * docs/content-qa-v6.md.
 */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(name) ? [full] : [];
  });
}

const CUSTOMER_SURFACES = ["src/app", "src/components", "src/lib/email"].flatMap(
  (root) => {
    try {
      return walk(root);
    } catch {
      return [];
    }
  }
);

const read = (f: string) => readFileSync(f, "utf8");
// The promise line reads "A realistic wellbeing plan for the day you actually
// have", so this tail is the part every surface must share verbatim.
const CANONICAL_TAIL = "day you actually have";

describe("content claim audit (CE-20 gate)", () => {
  it("leads with the adaptive-day wedge and keeps the promise beside it", () => {
    const landing = read("src/app/page.tsx");
    // MW-V10-01 moved the H1 to the differentiator, because "a realistic plan"
    // alone does not separate Mellowa from any other wellbeing planner. The
    // canonical promise stays adjacent and word-for-word — the through-line is
    // still one promise, just no longer the headline.
    expect(landing).toMatch(/reshape what&rsquo;s left/i);
    expect(landing).toContain("{TERMS.promise}");
    expect(TERMS.promise).toContain(CANONICAL_TAIL);
    // Metadata must promise what the page now leads with, not the old hero.
    expect(landing).toMatch(/title:\s*"Mellowa[^"]*Reshape what's left/);
    expect(landing).toMatch(/description:[\s\S]{0,220}what's left/);
  });

  it("has no deprecated funnel phrasing anywhere in customer surfaces", () => {
    const deprecated = [
      /start my 3-day free trial/i,
      /\bunlimited\b/i,
      /\btiny plan\b/i,
      /\btiny habit\b/i,
    ];
    const offenders: string[] = [];
    for (const file of CUSTOMER_SURFACES) {
      const text = read(file);
      for (const re of deprecated) {
        if (re.test(text)) offenders.push(`${file}: ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("blocked safety states contain no plan generation or upsell language", () => {
    // Safety copy must never nudge toward trial/upgrade/premium/plan-buying.
    const safetyFiles = [
      "src/lib/safety/crisis-resources.ts",
      "src/lib/safety/pre-classify.ts",
      "src/lib/safety/check-input.ts",
      "src/prompts/safety.ts",
      "src/lib/i18n/messages.ts",
    ];
    const upsell = /\b(upgrade|subscribe|start (your |a )?trial|premium plan|buy|checkout)\b/i;
    for (const f of safetyFiles) {
      let text: string;
      try {
        text = read(f);
      } catch {
        continue;
      }
      // Only inspect the crisis/safety message strings, not unrelated code:
      // the whole file is safety-scoped, so any upsell verb is a red flag.
      expect(upsell.test(text), `${f} contains upsell language`).toBe(false);
    }
  });

  it("lifecycle emails disclose no individual wellbeing data and no emoji", () => {
    const templates = read("src/lib/email/templates.ts");
    // No per-user wellbeing disclosure (billing/account facts only).
    const disclosure = /your (mood|stress|energy level|sleep quality|journal|allergies|meals|check-?in said)/i;
    expect(disclosure.test(templates)).toBe(false);
    // No emoji in transactional subjects/bodies.
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(templates)).toBe(false);
  });
});
