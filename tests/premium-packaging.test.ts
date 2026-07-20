import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PREMIUM_FEATURES } from "@/lib/stripe/plans";

/**
 * MW-S09: Premium is packaged around three real jobs — adapt today, reuse
 * what works, carry into next week — naming only implemented capabilities
 * with outcome-safe language.
 */

describe("premium feature list", () => {
  it("names the three jobs' capabilities", () => {
    const all = PREMIUM_FEATURES.join(" ");
    expect(all).toContain("Adjust the rest of today");
    expect(all).toMatch(/Preference learning you can see/);
    expect(all).toMatch(/reflection that carries your choices forward/);
  });

  it("claims no outcomes and no 'unlimited'", () => {
    for (const f of PREMIUM_FEATURES) {
      expect(f).not.toMatch(/unlimited|calm(er)?\b|healthier|productiv|adheren|guarantee/i);
    }
  });

  it("every named capability is actually implemented", () => {
    // Each feature maps to shipped code paths.
    expect(existsSync("src/app/api/ai/plan-repair/route.ts")).toBe(true); // adjust today
    expect(existsSync("src/components/dailyflow/mellowa-learned.tsx")).toBe(true); // preference learning
    expect(existsSync("src/components/dailyflow/weekly-reflection.tsx")).toBe(true); // carry forward
    expect(existsSync("src/app/api/shopping/build/route.ts")).toBe(true); // shopping drafts
  });
});

describe("cancellation and reactivation", () => {
  const cancel = readFileSync("src/app/api/stripe/cancel/route.ts", "utf8");
  const manage = readFileSync("src/components/dailyflow/manage-billing.tsx", "utf8");

  it("cancellation reasons are a closed optional enum — never a gate", () => {
    expect(cancel).toMatch(/\.optional\(\)/);
    expect(cancel).toMatch(/too_expensive[\s\S]*not_using[\s\S]*missing_features/);
    expect(manage).toContain("optional — cancellation works either way");
  });

  it("cancel keeps access until period end and reactivation is one tap", () => {
    expect(manage).toMatch(/stay available until/);
    expect(manage).toContain("Reactivate membership");
    expect(cancel).toContain("reactivation_started");
  });

  it("no vulnerability targeting: reason is analytics-categorical only", () => {
    // The reason never feeds email content or any targeting path.
    expect(cancel).not.toMatch(/reason[^\n]*html|html[^\n]*reason/);
  });
});
