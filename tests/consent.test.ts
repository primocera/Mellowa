import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  missingConsents,
  POLICY_VERSIONS,
  REQUIRED_CONSENTS,
} from "@/lib/consent/config";

const granted = (type: string, version: string, granted = true) => ({
  consent_type: type,
  version,
  granted,
});

const allCurrent = REQUIRED_CONSENTS.map((t) =>
  granted(t, POLICY_VERSIONS[t])
);

describe("consent model (Prompt 6)", () => {
  it("requires age, terms and privacy separately", () => {
    expect(REQUIRED_CONSENTS).toEqual(["age_18_plus", "terms", "privacy"]);
    expect(missingConsents([])).toEqual(REQUIRED_CONSENTS);
  });

  it("complete when all consents exist at current versions", () => {
    expect(missingConsents(allCurrent)).toEqual([]);
  });

  it("a policy version change re-requires that consent only", () => {
    const rows = [
      granted("age_18_plus", POLICY_VERSIONS.age_18_plus),
      granted("terms", "2020-01"), // outdated
      granted("privacy", POLICY_VERSIONS.privacy),
    ];
    expect(missingConsents(rows)).toEqual(["terms"]);
  });

  it("a revoked consent (granted=false) is missing even at current version", () => {
    const rows = [
      granted("age_18_plus", POLICY_VERSIONS.age_18_plus, false),
      granted("terms", POLICY_VERSIONS.terms),
      granted("privacy", POLICY_VERSIONS.privacy),
    ];
    expect(missingConsents(rows)).toEqual(["age_18_plus"]);
  });

  it("uses the newest row per consent (rows ordered newest-first)", () => {
    const rows = [
      granted("terms", POLICY_VERSIONS.terms), // newest: granted at current
      granted("terms", "2020-01", false), // older revocation ignored
      granted("age_18_plus", POLICY_VERSIONS.age_18_plus),
      granted("privacy", POLICY_VERSIONS.privacy),
    ];
    expect(missingConsents(rows)).toEqual([]);
  });

  it("optional marketing consent is never required", () => {
    expect(REQUIRED_CONSENTS).not.toContain("reminders_marketing");
  });
});

describe("MW-02: signup and onboarding copy contract", () => {
  const authForm = readFileSync("src/components/forms/auth-form.tsx", "utf8");
  const signup = readFileSync("src/app/(auth)/signup/page.tsx", "utf8");
  const wizard = readFileSync(
    "src/components/dailyflow/onboarding-wizard.tsx",
    "utf8"
  );

  it("legal consents are separate, explicit and never pre-checked", () => {
    // Two distinct required checkboxes; no defaultChecked/checked-true on them.
    expect(authForm).toMatch(/register\("age18"/);
    expect(authForm).toMatch(/register\("policies"/);
    expect(authForm).not.toMatch(/defaultChecked/);
  });

  it("signup states baseline + one sample and no payment method until Premium", () => {
    expect(signup).toMatch(/planning baseline/i);
    expect(signup).toMatch(/one free\s*sample|one free sample/i);
    expect(signup).toMatch(/No payment method until/i);
  });

  it("onboarding save failure shows safe copy, not raw provider errors", () => {
    expect(wizard).not.toMatch(/setError\(dbError\.message\)/);
    expect(wizard).toMatch(/couldn't be saved just now/i);
  });

  it("onboarding never solicits diagnosis details", () => {
    expect(wizard).not.toMatch(/diagnos|medication|which condition/i);
  });
});
