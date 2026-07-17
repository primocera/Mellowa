import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Funnel-truth copy regression (Launch audit v6, Prompt 2).
 * Customer-facing surfaces must not promise an unlimited product or a trial
 * that signup does not start. Trial CTAs belong to Pricing/Billing only.
 */

const UI_ROOTS = ["src/app", "src/components", "src/lib/email"];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

const files = UI_ROOTS.flatMap((root) => {
  try {
    return tsxFiles(root);
  } catch {
    return [];
  }
});

describe("funnel copy truth", () => {
  it("finds customer-facing surfaces to scan", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("has no customer-facing 'unlimited' claim", () => {
    const offenders = files.filter((f) =>
      /unlimited/i.test(readFileSync(f, "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  it("keeps 'Start my 3-day free trial' off the public landing page", () => {
    const landing = readFileSync("src/app/page.tsx", "utf8");
    expect(landing).not.toMatch(/start my 3-day free trial/i);
    expect(landing).toMatch(/create my free sample plan/i);
    expect(landing).toMatch(/no card for the sample/i);
  });
});
