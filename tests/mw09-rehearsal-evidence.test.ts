import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validateRehearsalEvidence,
  REQUIRED_STEPS,
  type RehearsalEvidence,
  type RehearsalGate,
} from "@/lib/release/rehearsal-evidence";

/**
 * MW-09 (v20): the owner-live rehearsal evidence validator and runbook contract.
 * Claude never runs the rehearsals; it proves that only complete, fresh,
 * sanitized evidence can close a gate.
 */

const SHA = "5fea5a98e763876c16a07f3ad63448a8e68b9bbd";

function fullEvidence(gate: RehearsalGate): RehearsalEvidence {
  const start = "2026-08-17T10:00:00Z";
  const steps = REQUIRED_STEPS[gate].map((id, i) => ({
    id,
    observedAt: `2026-08-17T10:${String(10 + i).padStart(2, "0")}:00Z`,
    status: "pass" as const,
    receipt: `obj_${i}`,
  }));
  return {
    gate,
    candidateSha: SHA,
    environment: "production",
    startedAt: start,
    completedAt: "2026-08-17T11:00:00Z",
    steps,
  };
}

describe("validateRehearsalEvidence (MW-09)", () => {
  it("accepts a complete, fresh, sanitized billing artifact", () => {
    const r = validateRehearsalEvidence(fullEvidence("billing"), { expectedSha: SHA });
    expect(r.ok, r.violations.join(" | ")).toBe(true);
  });

  it("rejects stale evidence from another candidate SHA", () => {
    const ev = fullEvidence("billing");
    ev.candidateSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const r = validateRehearsalEvidence(ev, { expectedSha: SHA });
    expect(r.ok).toBe(false);
    expect(r.violations.join(" ")).toMatch(/stale/);
  });

  it("rejects a billing run with a missing refund step", () => {
    const ev = fullEvidence("billing");
    ev.steps = ev.steps.filter((s) => s.id !== "refund");
    const r = validateRehearsalEvidence(ev, { expectedSha: SHA });
    expect(r.ok).toBe(false);
    expect(r.violations.join(" ")).toMatch(/refund/);
  });

  it("rejects a missing transition on any gate", () => {
    const ev = fullEvidence("deletion");
    ev.steps = ev.steps.filter((s) => s.id !== "stripe_cancellation");
    expect(validateRehearsalEvidence(ev, { expectedSha: SHA }).ok).toBe(false);
  });

  it("rejects a step observed outside the run window", () => {
    const ev = fullEvidence("cron");
    ev.steps[0].observedAt = "2020-01-01T00:00:00Z";
    expect(validateRehearsalEvidence(ev, { expectedSha: SHA }).ok).toBe(false);
  });

  it("rejects any PII / card / token in the artifact", () => {
    for (const bad of ["user@example.com", "4242 4242 4242 4242", "Bearer secrettoken"]) {
      const ev = fullEvidence("email");
      ev.steps[0].receipt = bad;
      const r = validateRehearsalEvidence(ev, { expectedSha: SHA });
      expect(r.ok, `should reject ${bad}`).toBe(false);
    }
  });

  it("rejects a live gate observed in a non-production environment", () => {
    const ev = fullEvidence("billing");
    ev.environment = "disposable";
    expect(validateRehearsalEvidence(ev, { expectedSha: SHA }).ok).toBe(false);
  });

  it("rejects a zero-test or failing synthetic-transition claim", () => {
    const ev = { ...fullEvidence("outbox"), environment: "synthetic" as const, testCounts: { total: 0, passed: 0, failed: 0 } };
    expect(validateRehearsalEvidence(ev, { expectedSha: SHA }).ok).toBe(false);
    const failing = { ...ev, testCounts: { total: 5, passed: 4, failed: 1 } };
    expect(validateRehearsalEvidence(failing, { expectedSha: SHA }).ok).toBe(false);
  });

  it("a failed step keeps the gate open", () => {
    const ev = fullEvidence("reminder");
    ev.steps[2].status = "fail";
    expect(validateRehearsalEvidence(ev, { expectedSha: SHA }).ok).toBe(false);
  });
});

describe("v20 rehearsal runbook contract (MW-09)", () => {
  const doc = readFileSync("docs/runbooks/v20-rehearsals.md", "utf8");
  const flat = doc.replace(/\s+/g, " ");

  it("documents every gate with all its required steps and a STOP condition", () => {
    for (const gate of Object.keys(REQUIRED_STEPS) as RehearsalGate[]) {
      for (const step of REQUIRED_STEPS[gate]) {
        expect(flat, `${gate}/${step} undocumented`).toContain(step);
      }
    }
    // Each gate section names a STOP condition.
    const stops = (flat.match(/STOP conditions:/g) ?? []).length;
    expect(stops).toBeGreaterThanOrEqual(6);
  });

  it("keeps live actions owner-only and references the foreign-app isolation", () => {
    expect(flat).toMatch(/OWNER-ONLY|owner-only/);
    expect(flat).toMatch(/foreign-app/i);
    expect(flat).toMatch(/Claude Code never/);
  });
});
