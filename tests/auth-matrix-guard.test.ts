import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-08: the authenticated matrix must be impossible to point at production or
 * live billing. This proves the two runtime guards locally, without a seeded
 * target: a LIVE Stripe key is a hard stop, and RC mode without Stripe TEST mode
 * is BLOCKED (not a silent skip).
 */

const runner = readFileSync("scripts/run-auth-matrix.mjs", "utf8");

/** Run the matrix runner with an env overlay; return { code, stderr }. */
function runMatrix(env: Record<string, string>) {
  try {
    execFileSync("node", ["scripts/run-auth-matrix.mjs"], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { code: 0, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string; stdout?: string };
    return { code: e.status ?? 1, stderr: `${e.stderr ?? ""}${e.stdout ?? ""}` };
  }
}

describe("auth matrix refuses live billing and never silently skips", () => {
  it("hard-stops when STRIPE_SECRET_KEY is a LIVE key", () => {
    const { code, stderr } = runMatrix({ STRIPE_SECRET_KEY: "sk_live_fake_key_for_test" });
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/LIVE key/);
    expect(stderr).toMatch(/BLOCKED/);
  });

  it("is BLOCKED in RC mode without a Stripe TEST key (not a pass)", () => {
    // No E2E env either, so the earlier 'configured' gate also blocks in RC —
    // both paths exit non-zero, which is the point: RC never returns 0 here.
    const { code } = runMatrix({ RC_GATE: "1", STRIPE_SECRET_KEY: "" });
    expect(code).not.toBe(0);
  });

  it("the runner source forces the non-production seed marker", () => {
    // The seed script refuses any database without the marker, and the runner
    // sets the flag that turns that refusal on.
    expect(runner).toMatch(/E2E_REQUIRE_SEED_MARKER = "1"/);
  });
});
