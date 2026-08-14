import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  redactValue,
  redactObject,
  latencyBucket,
  logEvent,
  diagnosticReceipt,
} from "@/lib/observability/log";
import {
  SLOS,
  REQUIRED_JOURNEYS,
  evaluateSlo,
  evaluateAll,
} from "@/lib/observability/slo";

/**
 * MW-V18-X02: the structured logger redacts PII/secrets and never throws; SLOs
 * cover every critical journey, each names a real runbook, and evaluation
 * reports unavailable rather than a false healthy. A diagnostic receipt carries
 * no PII.
 */

describe("redaction", () => {
  it("strips emails, tokens and long secrets from values", () => {
    expect(redactValue("contact jane.doe@example.com now")).toBe("contact [email] now");
    expect(redactValue("key sk_live_ABCDEF123456 leaked")).toContain("[token]");
    expect(redactValue("Bearer eyJhbGciOiJIUzI1Niwabc123")).toContain("[token]");
    expect(redactValue("whsec_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c")).toContain("[token]");
  });

  it("drops forbidden keys entirely and never logs nested objects verbatim", () => {
    const out = redactObject({
      account_ref: "u-123",
      email: "a@b.com",
      notes: "I skipped meals and feel anxious",
      mood: "low",
      nested: { secret: "x" },
    });
    expect(out.email).toBe("[redacted]");
    expect(out.notes).toBe("[redacted]");
    expect(out.mood).toBe("[redacted]");
    expect(out.nested).toBe("[redacted:object]");
    expect(out.account_ref).toBe("u-123");
  });
});

describe("latency buckets", () => {
  it("maps ms to coarse buckets, including invalid → gte5s", () => {
    expect(latencyBucket(10)).toBe("lt50");
    expect(latencyBucket(150)).toBe("lt200");
    expect(latencyBucket(400)).toBe("lt500");
    expect(latencyBucket(900)).toBe("lt1s");
    expect(latencyBucket(3000)).toBe("lt5s");
    expect(latencyBucket(9000)).toBe("gte5s");
    expect(latencyBucket(-1)).toBe("gte5s");
  });
});

describe("logEvent", () => {
  it("emits one redacted JSON line, returns a trace id, and never leaks an email", () => {
    const lines: string[] = [];
    const traceId = logEvent(
      { route: "api/ai/daily-plan", result: "error", code: "provider_timeout", accountRef: "u-1", latencyMs: 8000 },
      (l) => lines.push(l)
    );
    expect(traceId).toMatch(/^t_/);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.route).toBe("api/ai/daily-plan");
    expect(parsed.latency_bucket).toBe("gte5s");
    expect(parsed.trace_id).toBe(traceId);
    expect(lines[0]).not.toMatch(/@/); // no email ever
  });

  it("never throws, even if the sink throws", () => {
    expect(() =>
      logEvent({ route: "x", result: "ok" }, () => {
        throw new Error("sink down");
      })
    ).not.toThrow();
  });

  it("diagnostic receipt carries only an opaque reference and a timestamp", () => {
    const r = diagnosticReceipt("t_abc123");
    expect(r.reference).toBe("t_abc123");
    expect(Object.keys(r).sort()).toEqual(["at", "reference"]);
  });
});

describe("SLO catalog", () => {
  it("covers every required critical journey", () => {
    const covered = new Set(SLOS.map((s) => s.journey));
    for (const j of REQUIRED_JOURNEYS) {
      expect(covered.has(j), `no SLO for journey "${j}"`).toBe(true);
    }
  });

  it("every SLO names a runbook file that exists", () => {
    for (const s of SLOS) {
      expect(() => readFileSync(s.runbook, "utf8"), `${s.id}: ${s.runbook} missing`).not.toThrow();
    }
  });

  it("has unique ids", () => {
    expect(new Set(SLOS.map((s) => s.id)).size).toBe(SLOS.length);
  });
});

describe("SLO evaluation", () => {
  const rate = SLOS.find((s) => s.id === "auth_success")!;
  const ceiling = SLOS.find((s) => s.id === "deletion_stuck")!;

  it("success-rate: below target breaches, just above degrades, higher is healthy", () => {
    // target 0.99 → degraded band [0.99, 0.995).
    expect(evaluateSlo(rate, 0.985).state).toBe("breached");
    expect(evaluateSlo(rate, 0.992).state).toBe("degraded");
    expect(evaluateSlo(rate, 0.999).state).toBe("healthy");
  });

  it("count-ceiling: over target breaches", () => {
    expect(evaluateSlo(ceiling, 3).state).toBe("breached");
    expect(evaluateSlo(ceiling, 0).state).toBe("healthy");
  });

  it("a missing observation is UNAVAILABLE, never a false healthy", () => {
    expect(evaluateSlo(rate, null).state).toBe("unavailable");
    expect(evaluateSlo(rate, undefined).state).toBe("unavailable");
    const all = evaluateAll({});
    expect(all.every((e) => e.state === "unavailable")).toBe(true);
  });
});
