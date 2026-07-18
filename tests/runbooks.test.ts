import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Governance runbooks (Launch v6, Prompt 24). */

const incident = readFileSync("docs/runbooks/incident-response.md", "utf8");
const privacy = readFileSync("docs/runbooks/privacy-requests.md", "utf8");
const safety = readFileSync("docs/runbooks/safety-operations.md", "utf8");
const tabletop = readFileSync("docs/runbooks/tabletop-log.md", "utf8");

describe("incident runbooks", () => {
  it("covers every required critical scenario", () => {
    for (const scenario of [
      "Data exposure",
      "Auth abuse",
      "Unsafe AI output",
      "Allergen incident",
      "Provider outage",
      "Billing drift",
      "Email mis-send",
    ]) {
      expect(incident.includes(scenario), `missing runbook: ${scenario}`).toBe(true);
    }
  });

  it("every critical incident has owner, escalation, customer message, recovery check", () => {
    // Counts must line up: one of each per the seven scenarios.
    const count = (needle: string) => incident.split(needle).length - 1;
    expect(count("**Owner:**")).toBeGreaterThanOrEqual(7);
    expect(count("**Escalation path:**")).toBeGreaterThanOrEqual(7);
    expect(count("**Customer message:**")).toBeGreaterThanOrEqual(7);
    expect(count("**Recovery check:**")).toBeGreaterThanOrEqual(7);
  });

  it("defines severity levels", () => {
    expect(incident).toMatch(/SEV1/);
    expect(incident).toMatch(/SEV2/);
    expect(incident).toMatch(/SEV3/);
  });
});

describe("privacy workflow", () => {
  it("documents access/delete/correction, identity verification and a deadline", () => {
    expect(privacy).toMatch(/access/i);
    expect(privacy).toMatch(/deletion|erasure/i);
    expect(privacy).toMatch(/correction/i);
    expect(privacy).toMatch(/verify identity/i);
    expect(privacy).toMatch(/30 days|one-month/i);
  });

  it("lists subprocessors for DPA review", () => {
    for (const p of ["Supabase", "Stripe", "Resend", "Vercel"]) {
      expect(privacy.includes(p), `subprocessor missing: ${p}`).toBe(true);
    }
  });

  it("keeps routine triage to metadata only", () => {
    expect(privacy).toMatch(/metadata only/i);
    expect(privacy).toMatch(/inspect journal text|never.{0,12}journal/i);
  });
});

describe("safety operations", () => {
  it("states 180-day retention, sampling and the two hard prohibitions", () => {
    expect(safety).toMatch(/180-day|180 days/);
    expect(safety).toMatch(/sampling/i);
    expect(safety).toMatch(/never diagnoses|not diagnose/i);
    expect(safety).toMatch(/not crisis monitoring/i);
  });
});

describe("tabletop evidence", () => {
  it("records the three required drills with owners and actions", () => {
    expect(tabletop).toMatch(/provider outage/i);
    expect(tabletop).toMatch(/billing drift/i);
    expect(tabletop).toMatch(/sensitive logging/i);
    expect(tabletop).toMatch(/Action\/owner/);
  });
});
