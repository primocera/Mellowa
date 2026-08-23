import { describe, expect, it } from "vitest";
import { resolveLaunchMode as resolveTs } from "@/lib/health";
import { resolveLaunchMode as resolveCli } from "../scripts/launch-mode.mjs";

/**
 * WS-C (v21): ONE canonical launch tier. The release check
 * (scripts/launch-mode.mjs) and runtime deep readiness (src/lib/health.ts) MUST
 * classify the same environment identically — otherwise release tooling could
 * evaluate paid while the running app silently evaluates beta. This proves the
 * two resolvers agree across a matrix, and locks the contract itself.
 */

type Env = Record<string, string | undefined>;

const MATRIX: Array<{ name: string; env: Env; mode: "beta" | "paid"; ok: boolean }> = [
  { name: "unset in dev → beta, ok", env: {}, mode: "beta", ok: true },
  {
    name: "unset in production → paid gating, misconfigured",
    env: { NODE_ENV: "production" },
    mode: "paid",
    ok: false,
  },
  { name: "beta explicit", env: { LAUNCH_MODE: "beta" }, mode: "beta", ok: true },
  { name: "paid explicit", env: { LAUNCH_MODE: "paid" }, mode: "paid", ok: true },
  {
    name: "paid in production",
    env: { LAUNCH_MODE: "paid", NODE_ENV: "production" },
    mode: "paid",
    ok: true,
  },
  {
    name: "beta in production",
    env: { LAUNCH_MODE: "beta", NODE_ENV: "production" },
    mode: "beta",
    ok: true,
  },
  { name: "invalid value → misconfigured", env: { LAUNCH_MODE: "prod" }, mode: "paid", ok: false },
  {
    name: "invalid value in production → misconfigured",
    env: { LAUNCH_MODE: "prod", NODE_ENV: "production" },
    mode: "paid",
    ok: false,
  },
  {
    name: "legacy alias agrees (paid)",
    env: { LAUNCH_MODE: "paid", READINESS_MODE: "paid" },
    mode: "paid",
    ok: true,
  },
  {
    name: "legacy alias agrees (beta)",
    env: { LAUNCH_MODE: "beta", READINESS_MODE: "beta" },
    mode: "beta",
    ok: true,
  },
  {
    name: "legacy alias disagrees → misconfigured",
    env: { LAUNCH_MODE: "paid", READINESS_MODE: "beta" },
    mode: "paid",
    ok: false,
  },
  {
    name: "legacy-only in dev disagrees with canonical beta → misconfigured",
    env: { READINESS_MODE: "paid" },
    mode: "beta",
    ok: false,
  },
  {
    name: "legacy invalid value → misconfigured",
    env: { LAUNCH_MODE: "paid", READINESS_MODE: "prod" },
    mode: "paid",
    ok: false,
  },
];

describe("launch-mode resolver parity (runtime vs release-check)", () => {
  for (const c of MATRIX) {
    it(`agrees and matches the contract: ${c.name}`, () => {
      const ts = resolveTs(c.env);
      const cli = resolveCli(c.env);
      // The two implementations must agree on both fields.
      expect({ mode: cli.mode, ok: cli.ok }).toEqual({ mode: ts.mode, ok: ts.ok });
      // ...and match the intended contract.
      expect(ts.mode).toBe(c.mode);
      expect(ts.ok).toBe(c.ok);
    });
  }

  it("a misconfiguration always carries a safe (non-secret) problem string", () => {
    for (const c of MATRIX.filter((m) => !m.ok)) {
      const res = resolveTs(c.env);
      expect(res.problem, c.name).toBeTruthy();
      // never echo an env value
      expect(res.problem).not.toMatch(/sk_|secret|password|key=/i);
    }
  });
});
