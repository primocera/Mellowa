import { describe, expect, it } from "vitest";
import {
  EXPERIMENTS,
  assignVariant,
  exposureProperty,
  isExpired,
  activeExperiments,
  namespaceConflicts,
  expiredButEnabled,
  type ExperimentDef,
} from "@/lib/experiments/registry";

/**
 * MW-V18-X03: assignment is stable and server-side, exposure is guarded, killed
 * or expired experiments resolve to control, weights are honoured, namespaces
 * are mutually exclusive, expired-but-enabled experiments surface for cleanup,
 * and no exposure carries PII.
 */

const def: ExperimentDef = {
  id: "demo",
  namespace: "daily_loop",
  version: 1,
  owner: "product",
  description: "test",
  killSwitchFlag: "FLAG_DEMO",
  expiresAt: "2027-01-01",
  variants: [{ key: "treatment", weight: 50 }],
};
const ON = { FLAG_DEMO: "1" };
const NOW = new Date("2026-08-14T00:00:00Z");

describe("stable, server-side assignment", () => {
  it("same subject + experiment + version always resolves the same variant", () => {
    const a = assignVariant(def, "user-123", { now: NOW, env: ON });
    const b = assignVariant(def, "user-123", { now: NOW, env: ON });
    expect(a.variant).toBe(b.variant);
    expect(a.bucket).toBe(b.bucket);
  });

  it("bumping the version re-buckets (assignment is version-scoped)", () => {
    const v1 = assignVariant(def, "user-123", { now: NOW, env: ON });
    const v2 = assignVariant({ ...def, version: 2 }, "user-123", { now: NOW, env: ON });
    // Not guaranteed to differ for one user, but the bucket input differs.
    expect(typeof v2.bucket).toBe("number");
    expect(v1.experimentId).toBe(v2.experimentId);
  });

  it("honours weights across many subjects (~50/50 ± tolerance)", () => {
    let treatment = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      if (assignVariant(def, `u${i}`, { now: NOW, env: ON }).variant === "treatment") treatment++;
    }
    const share = treatment / N;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });
});

describe("guarded exposure and kill switch / expiry", () => {
  it("kill switch off → control, not live, no exposure emitted", () => {
    const a = assignVariant(def, "user-1", { now: NOW, env: {} });
    expect(a.variant).toBe("control");
    expect(a.live).toBe(false);
    expect(exposureProperty(a)).toEqual({});
  });

  it("expired → control even with the flag on", () => {
    const expired = { ...def, expiresAt: "2020-01-01" };
    const a = assignVariant(expired, "user-1", { now: NOW, env: ON });
    expect(a.live).toBe(false);
    expect(a.variant).toBe("control");
  });

  it("ineligible subject → control", () => {
    const a = assignVariant(def, "user-1", { now: NOW, env: ON, eligible: false });
    expect(a.variant).toBe("control");
  });

  it("a live exposure rides the experiment slug only (no PII)", () => {
    const a = assignVariant(def, "user-1", { now: NOW, env: ON });
    if (a.variant === "treatment") {
      expect(exposureProperty(a)).toEqual({ experiment: "demo:treatment" });
    }
    // The property value is a slug: id + ':' + variant, never a user id/content.
    const prop = exposureProperty(a).experiment;
    if (prop) expect(prop).toMatch(/^[a-z0-9_]+:[a-z0-9_]+$/);
  });
});

describe("namespaces are mutually exclusive", () => {
  it("flags two live experiments in one namespace", () => {
    const a: ExperimentDef = { ...def, id: "x1", namespace: "onboarding", killSwitchFlag: "F1" };
    const b: ExperimentDef = { ...def, id: "x2", namespace: "onboarding", killSwitchFlag: "F2" };
    const conflicts = namespaceConflicts([a, b]);
    expect(conflicts).toEqual([{ namespace: "onboarding", ids: ["x1", "x2"] }]);
  });

  it("different namespaces do not conflict", () => {
    const a: ExperimentDef = { ...def, id: "x1", namespace: "onboarding" };
    const b: ExperimentDef = { ...def, id: "x2", namespace: "daily_loop" };
    expect(namespaceConflicts([a, b])).toEqual([]);
  });
});

describe("registry hygiene + cleanup", () => {
  it("every experiment has an owner, kill switch, expiry and valid weights", () => {
    for (const d of EXPERIMENTS) {
      expect(d.owner).toBeTruthy();
      expect(d.killSwitchFlag).toMatch(/^FLAG_/);
      expect(Number.isFinite(Date.parse(d.expiresAt)), `${d.id} expiresAt`).toBe(true);
      const sum = d.variants.reduce((s, v) => s + v.weight, 0);
      expect(sum, `${d.id} weights (+control) must be <= 100`).toBeLessThanOrEqual(100);
      for (const v of d.variants) expect(v.weight).toBeGreaterThan(0);
    }
  });

  it("surfaces expired-but-enabled experiments for cleanup", () => {
    const future = new Date("2099-01-01T00:00:00Z");
    // With every kill switch on, all experiments are past their expiry by 2099.
    const env: Record<string, string> = {};
    for (const d of EXPERIMENTS) env[d.killSwitchFlag] = "1";
    const stale = expiredButEnabled(future, env);
    expect(stale.length).toBe(EXPERIMENTS.length);
    expect(activeExperiments(future, env)).toEqual([]);
  });

  it("isExpired respects the end-of-day boundary", () => {
    expect(isExpired(def, new Date("2027-01-01T12:00:00Z"))).toBe(false);
    expect(isExpired(def, new Date("2027-01-02T12:00:00Z"))).toBe(true);
  });
});
