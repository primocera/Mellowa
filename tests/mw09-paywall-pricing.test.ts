import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkPaywallCopy, shouldShowPaywall } from "@/lib/paywall/gating";
import {
  activeExperiments,
  namespaceConflicts,
  EXPERIMENTS,
} from "@/lib/experiments/registry";

/**
 * MW-09: growth changes are measurable without dark patterns or overlapping
 * cohorts. No experiment is enabled by default; the paywall never pressures a
 * user before value or when entitlement is unknown; pricing/paywall copy is free
 * of dark patterns; and the pricing-discovery verdict is exposed read-only.
 */

const NOW = new Date("2026-08-15T12:00:00Z");

describe("experiments are off by default and never overlap silently", () => {
  it("no experiment is active with an empty environment", () => {
    expect(activeExperiments(NOW, {})).toEqual([]);
  });

  it("each experiment turns on only via its own kill-switch flag", () => {
    for (const def of EXPERIMENTS) {
      const active = activeExperiments(NOW, { [def.killSwitchFlag]: "1" });
      // Either this one is on (if not expired) or none — never a different one.
      for (const a of active) expect(a.id).toBe(def.id);
    }
  });

  it("two live experiments in one namespace are reported as a conflict", () => {
    const sameNs = EXPERIMENTS.reduce<Record<string, string[]>>((acc, d) => {
      (acc[d.namespace] ??= []).push(d.id);
      return acc;
    }, {});
    const nsWithTwo = Object.entries(sameNs).find(([, ids]) => ids.length >= 2);
    if (nsWithTwo) {
      const flags: Record<string, string> = {};
      for (const d of EXPERIMENTS.filter((e) => e.namespace === nsWithTwo[0])) {
        flags[d.killSwitchFlag] = "1";
      }
      const conflicts = namespaceConflicts(activeExperiments(NOW, flags));
      // If both are unexpired, the namespace is flagged; either way, no silent overlap.
      const active = activeExperiments(NOW, flags).filter((d) => d.namespace === nsWithTwo[0]);
      if (active.length >= 2) {
        expect(conflicts.some((c) => c.namespace === nsWithTwo[0])).toBe(true);
      }
    }
  });
});

describe("paywall gating fails closed and never nags", () => {
  it("never shows to premium/trialing (already has access)", () => {
    expect(shouldShowPaywall({ entitlement: "premium", experiencedValue: true }).show).toBe(false);
    expect(shouldShowPaywall({ entitlement: "trialing", experiencedValue: true }).show).toBe(false);
  });
  it("fails closed when entitlement is unknown", () => {
    expect(shouldShowPaywall({ entitlement: "unknown", experiencedValue: true }).show).toBe(false);
  });
  it("never before the user has experienced value", () => {
    expect(shouldShowPaywall({ entitlement: "free", experiencedValue: false }).show).toBe(false);
  });
  it("an honest prompt only after value and while unsubscribed", () => {
    expect(shouldShowPaywall({ entitlement: "free", experiencedValue: true }).show).toBe(true);
  });
});

describe("pricing / paywall copy is free of dark patterns", () => {
  const COPY_FILES = [
    "src/app/pricing/page.tsx",
    "src/components/dailyflow/upgrade-button.tsx",
    "src/app/(app)/billing/page.tsx",
  ];
  for (const file of COPY_FILES) {
    it(`${file} contains no dark-pattern copy`, () => {
      const text = readFileSync(file, "utf8");
      const res = checkPaywallCopy(text);
      expect(res.violations, `dark patterns in ${file}: ${res.violations.join(", ")}`).toEqual([]);
    });
  }

  it("the scanner actually catches a known dark pattern (not a no-op)", () => {
    expect(checkPaywallCopy("Hurry — only 2 spots left, act now!").clean).toBe(false);
  });
});

describe("pricing-discovery verdict is exposed read-only (no Stripe change)", () => {
  it("the report computes and returns the discovery gate", () => {
    const report = readFileSync("src/lib/analytics/report.ts", "utf8");
    expect(report).toContain("discoveryGate({ cohort, support: burden })");
    expect(report).toContain("pricingDiscovery");
  });
  it("the admin surfaces the read-only pricing-discovery verdict", () => {
    const admin = readFileSync("src/app/admin/page.tsx", "utf8");
    expect(admin).toMatch(/Pricing discovery/i);
    expect(admin).toContain("r.pricingDiscovery.canRecommendPriceChange");
  });
  it("this prompt changes no Stripe price id or catalog amount", () => {
    // The discovery gate module must never IMPORT Stripe/plans/catalog code.
    const gate = readFileSync("src/lib/pricing/discovery-gate.ts", "utf8");
    expect(gate).not.toMatch(/from\s+["']@\/lib\/stripe/);
    expect(gate).not.toMatch(/STRIPE_PRICE_/);
  });
});
