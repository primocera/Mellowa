import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ReleaseManifest } from "@/lib/release/manifest";

/**
 * MW-FINAL + XAPP-FINAL (v20): the final certification and two-app launch plan
 * must be TRUTHFUL — no bare GO while an owner gate is not_run, no verdict the
 * manifest does not hold, and the cross-app plan never couples release truth.
 */

const cert = readFileSync("docs/release/v20/FINAL-CERTIFICATION.md", "utf8");
const xapp = readFileSync("docs/release/v20/XAPP-FINAL-launch-plan.md", "utf8");
const manifest = JSON.parse(
  readFileSync("docs/release/manifest.v20.json", "utf8")
) as ReleaseManifest;

describe("MW-FINAL certification is truthful", () => {
  it("does not contradict the machine-readable manifest (all tiers UNASSESSED)", () => {
    for (const v of Object.values(manifest.verdicts)) expect(v).toBe("UNASSESSED");
    // The manifest still validates (nothing certified into it).
    expect(manifest.rcSha).toBeNull();
    expect(manifest.candidateLifecycle).toBe("draft");
  });

  it("assigns no tier a GO verdict while owner gates are not_run", () => {
    // Verdicts in the matrix are bold; a GO/CONDITIONAL GO verdict would appear
    // as **GO** / **CONDITIONAL GO**. None may be present — only STRONG (a
    // capability note, not a launch verdict), CONDITIONAL —, BLOCKED, NO-GO.
    expect(cert).not.toMatch(/\*\*GO\b/);
    expect(cert).not.toMatch(/\*\*CONDITIONAL GO\*\*/);
    expect(cert).toMatch(/no tier says "GO"/i);
    // The tiers that could ship all read CONDITIONAL/BLOCKED/NO-GO.
    expect(cert).toMatch(/\*\*BLOCKED/);
    expect(cert).toMatch(/\*\*NO-GO\*\*/);
  });

  it("names each owner gate as NOT RUN and gives an owner action", () => {
    for (const gate of [
      "migrations 050",
      "immutable RC",
      "authenticated E2E",
      "rehearsal",
    ]) {
      expect(cert).toContain(gate);
    }
    expect(cert).toMatch(/NOT RUN/);
    expect(cert).toMatch(/Owner action|owner action|Next single action/);
  });

  it("keeps every paid/scale tier CONDITIONAL/BLOCKED and expansion on HOLD", () => {
    expect(cert).toMatch(/Bounded public paid[\s\S]*BLOCKED/);
    expect(cert).toMatch(/Unrestricted paid[\s\S]*NO-GO/);
    expect(cert).toMatch(/scaleDecision = HOLD|scaleDecision\s*=\s*HOLD|HOLD/);
  });
});

describe("XAPP-FINAL keeps release truth independent", () => {
  it("never opens both public-paid launches at once and forbids averaging", () => {
    expect(xapp).toMatch(/[Nn]ever open both public-paid/);
    expect(xapp).toMatch(/side by side|never averaged/);
  });

  it("a GO in one app cannot close a blocker in the other", () => {
    expect(xapp).toMatch(/cannot close a blocker in the other/);
  });

  it("a shared Stripe/provider incident stops both paid expansions", () => {
    expect(xapp).toMatch(/stops? both paid expansions|both paid expansions stop/i);
  });

  it("has a side-by-side per-app dashboard with the scenario responses", () => {
    expect(xapp).toContain("Scalvya");
    expect(xapp).toContain("Mellowa");
    for (const scenario of [
      "Scalvya healthy",
      "Shared Stripe incident",
      "support capacity exceeded",
    ]) {
      expect(xapp).toContain(scenario);
    }
  });
});
