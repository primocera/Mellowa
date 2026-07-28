import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BANNED_CUSTOMER_PHRASES, TERMS } from "@/lib/content/terminology";

/**
 * Content-system regression (Content Elevation v6, Prompt 1).
 * Customer-facing surfaces (.tsx + email templates) must not contain banned
 * diet-culture, medical/therapy or absolute-claim phrases.
 */

const UI_ROOTS = ["src/app", "src/components", "src/lib/email", "src/lib/content"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(tsx|ts)$/.test(name) ? [full] : [];
  });
}

const surfaces = UI_ROOTS.flatMap((root) => {
  try {
    return files(root);
  } catch {
    return [];
  }
}).filter((f) => !f.includes("terminology"));

/**
 * Compiled once, not once per file.
 *
 * These were being rebuilt inside the per-file loop — every banned phrase
 * escaped and `new RegExp`'d again for each surface — so the work grew with
 * the file count, which grows every release. Hoisting is a straight win
 * regardless of the timeout question (see vitest.config.ts for that).
 */
const BANNED_PATTERNS = BANNED_CUSTOMER_PHRASES.map(
  (phrase) =>
    [
      phrase,
      new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
    ] as const,
);

describe("content system (v6 CE Prompt 1)", () => {
  it("scans a real surface set", () => {
    expect(surfaces.length).toBeGreaterThan(20);
  });

  it("bans diet-culture, clinical and absolute phrases on customer surfaces", () => {
    const offenders: string[] = [];
    for (const file of surfaces) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const [phrase, re] of BANNED_PATTERNS) {
        for (const line of lines) {
          if (!re.test(line)) continue;
          // Safety prohibitions ("never diagnose", "can't diagnose", …) are
          // required language, not a violation.
          if (/\b(do not|don'?t|never|not a|won'?t|can'?t|cannot|no)\b[^.]*$/i.test(
            line.slice(0, line.search(re))
          )) {
            continue;
          }
          offenders.push(`${file}: "${phrase}"`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the canonical promise and funnel language stable", () => {
    expect(TERMS.promise).toBe(
      "A realistic wellbeing plan for the day you actually have."
    );
    expect(TERMS.difference).toBe(
      "No calorie targets. No streak pressure. No starting over."
    );
    expect(TERMS.sampleCta).toBe("Create my free sample plan");
  });
});
