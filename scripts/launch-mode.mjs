/**
 * Canonical launch-mode resolver for CLI tooling (mirror of
 * src/lib/health.ts::resolveLaunchMode).
 *
 * ONE canonical contract: LAUNCH_MODE=beta|paid. READINESS_MODE is a deprecated
 * alias that, if present, MUST agree with LAUNCH_MODE. A production deployment
 * with LAUNCH_MODE unset/invalid is a misconfiguration and never silently
 * defaults to beta.
 *
 * A parity test (tests/launch-mode-parity.test.ts) runs this and the TypeScript
 * resolver against the same synthetic environments and asserts identical
 * { mode, ok } results, so the release check and runtime readiness cannot drift.
 */

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ mode: "beta" | "paid", ok: boolean, problem?: string }}
 */
export function resolveLaunchMode(env = process.env) {
  const raw = env.LAUNCH_MODE;
  const legacy = env.READINESS_MODE;
  const isProd = env.NODE_ENV === "production";

  /** @type {"beta" | "paid"} */
  let mode;
  let ok = true;
  /** @type {string | undefined} */
  let problem;

  if (raw === "paid" || raw === "beta") {
    mode = raw;
  } else if (raw == null || raw === "") {
    if (isProd) {
      ok = false;
      problem = "LAUNCH_MODE is not set in production";
      mode = "paid";
    } else {
      mode = "beta";
    }
  } else {
    ok = false;
    problem = "LAUNCH_MODE has an invalid value (allowed: beta, paid)";
    mode = "paid";
  }

  if (legacy != null && legacy !== "") {
    const legacyMode =
      legacy === "paid" ? "paid" : legacy === "beta" ? "beta" : null;
    if (legacyMode == null) {
      ok = false;
      problem = problem ?? "READINESS_MODE has an invalid value (allowed: beta, paid)";
    } else if (ok && legacyMode !== mode) {
      ok = false;
      problem = "READINESS_MODE disagrees with LAUNCH_MODE";
    }
  }

  return problem ? { mode, ok, problem } : { mode, ok };
}
