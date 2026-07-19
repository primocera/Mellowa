import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-08: one commercial truth. Billing mirrors server-derived trial
 * eligibility, prices come only from the canonical Stripe plan config, no
 * unsupported support SLAs, and the trial banner distinguishes today/tomorrow.
 */

const billing = readFileSync("src/app/(app)/billing/page.tsx", "utf8");
const banner = readFileSync(
  "src/components/dailyflow/trial-banner.tsx",
  "utf8"
);

describe("billing commercial truth (MW-08)", () => {
  it("states the exact free value (baseline + one lifetime sample, no card)", () => {
    expect(billing).toMatch(/one lifetime sample daily\s*plan/i);
    expect(billing).toMatch(/no payment method needed/i);
  });

  it("branches on server-derived trial eligibility — no second trial implied", () => {
    expect(billing).toContain("trial_used_at");
    expect(billing).toContain("trialEligible");
    expect(billing).toMatch(/already used your one Premium trial/i);
    expect(billing).toMatch(/pay today/i);
  });

  it("renders prices only from the canonical PRICING config", () => {
    expect(billing).toContain("PRICING.monthly.price");
    expect(billing).toContain("PRICING.yearly.price");
    expect(billing).not.toMatch(/€\d+\.\d+.{0,10}\/(mo|yr|month|year)/);
  });

  it("makes automatic renewal explicit and claims no support SLA", () => {
    expect(billing).toMatch(/renews automatically unless canceled/i);
    expect(billing).not.toMatch(/within \d+ (business )?days/i);
  });

  it("trial banner distinguishes ends-today from ends-tomorrow", () => {
    expect(banner).toContain("ends today");
    expect(banner).toContain("ends tomorrow");
  });
});
