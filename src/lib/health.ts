/**
 * Readiness aggregation (Launch audit v6, Prompt 5). Pure module.
 *
 * Components report ok/fail only — never connection strings, table names or
 * error details. The deep readiness route maps this to 200/503 so a free
 * uptime monitor (e.g. UptimeRobot) can alert the owner on any failure.
 */

/**
 * MW-04: the status vocabulary readiness reports.
 *  - ok            healthy and observed.
 *  - degraded      reachable but stale/backlogged (e.g. a worker with stuck jobs).
 *  - fail          a required object/signature is absent — always blocks readiness.
 *  - not_configured a non-critical dependency isn't wired (allowed in beta).
 *  - unavailable   the signal could not be observed (probe errored) — for a
 *                  critical component this is not "healthy" and blocks paid.
 */
export type ComponentStatus = "ok" | "degraded" | "fail" | "not_configured" | "unavailable";

export type ReadinessMode = "beta" | "paid";

export interface ReadinessReport {
  ok: boolean;
  mode?: ReadinessMode;
  components: Record<string, ComponentStatus>;
}

export interface SummarizeOptions {
  /** paid fails closed on a degraded/unavailable critical component; beta warns. */
  mode?: ReadinessMode;
  /** Component keys whose degraded/unavailable state blocks paid readiness. */
  critical?: readonly string[];
}

/**
 * Aggregate component statuses into an overall verdict.
 *
 * A "fail" (missing required object/signature) always blocks readiness. In
 * paid mode a critical component that is "degraded" (stale/backlogged) or
 * "unavailable" (unobserved) also blocks — a configured secret without observed
 * worker freshness is not treated as healthy. In beta mode those are warn-only.
 * "not_configured" never blocks. Called with no options it keeps the original
 * behaviour (fail only on "fail").
 */
export function summarizeReadiness(
  components: Record<string, ComponentStatus>,
  opts: SummarizeOptions = {}
): ReadinessReport {
  const critical = new Set(opts.critical ?? []);
  const paid = opts.mode === "paid";
  const ok = Object.entries(components).every(([key, s]) => {
    if (s === "fail") return false;
    // MW-04: in paid mode a CRITICAL component that is degraded, unavailable OR
    // not_configured fails closed. A missing paid-critical secret (Stripe/AI/
    // cron/email/legal) is treated as "not_configured" but is not acceptable for
    // paid — only for beta, where these keys are not marked critical.
    if (
      paid &&
      critical.has(key) &&
      (s === "degraded" || s === "unavailable" || s === "not_configured")
    ) {
      return false;
    }
    return true;
  });
  return opts.mode ? { ok, mode: opts.mode, components } : { ok, components };
}

/**
 * Classify the result of probing an RPC overload (MW-V10-00).
 *
 * The probe deliberately passes a malformed uuid, which lets us tell the two
 * outcomes apart without ever running the function body — so readiness can
 * never consume a generation, write usage or mutate a plan:
 *
 *   - no error → the function executed cleanly (side-effect-free probe): ok.
 *   - PGRST202 "function not found in schema cache" / "could not find the
 *     function" → the overload the app calls does not exist. Fail.
 *   - 22P02 invalid input syntax (the EXPECTED coercion error from the malformed
 *     uuid) → the signature resolved and argument coercion ran: ok.
 *   - anything else — permission denied (42501), statement timeout (57014),
 *     transport/cache/unknown — is NOT proof the overload is healthy, so it is
 *     reported as "unavailable" and (for a critical component in paid mode)
 *     fails closed. Previously any non-PGRST202 error was optimistically "ok",
 *     which could mask a permission or transport fault as healthy (MW-04).
 *
 * A missing overload is exactly the failure that would surface as a runtime
 * 500 on the first real generation after a deploy, which is far too late.
 */
export function classifyRpcProbe(
  error: { code?: string; message?: string } | null
): ComponentStatus {
  if (!error) return "ok"; // Executed cleanly — the overload is certainly there.
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "PGRST202" || /could not find the function/i.test(message)) {
    return "fail";
  }
  // The precise expected coercion error proves the signature resolved.
  if (code === "22P02" || /invalid input syntax|invalid input value/i.test(message)) {
    return "ok";
  }
  // Permission, timeout, transport, cache, unknown — not observed as healthy.
  return "unavailable";
}

/**
 * MW-04: classify a job worker's freshness from side-effect-free counts.
 *  - a dead-letter or stuck job → degraded (needs an operator, but reachable);
 *  - a due item older than maxDueAgeMs → degraded (the worker is behind);
 *  - otherwise ok. Counts only — never ids, addresses or content.
 */
export function classifyWorkerFreshness(args: {
  stuckOrDead: number;
  oldestDueMs?: number | null;
  now?: number;
  maxDueAgeMs?: number;
}): ComponentStatus {
  const now = args.now ?? Date.now();
  const maxAge = args.maxDueAgeMs ?? 6 * 60 * 60 * 1000; // 6h default backlog tolerance
  if (args.stuckOrDead > 0) return "degraded";
  if (args.oldestDueMs != null && now - args.oldestDueMs > maxAge) return "degraded";
  return "ok";
}

/**
 * The launch tier this deployment runs at.
 *  - mode     the effective gating tier (beta|paid).
 *  - ok       false → the launch-mode configuration is inconsistent and
 *             readiness MUST fail closed (and the release check MUST exit
 *             non-zero). Never run production as beta by accident.
 *  - problem  a safe, non-secret description of the misconfiguration.
 */
export interface LaunchModeResolution {
  mode: ReadinessMode;
  ok: boolean;
  problem?: string;
}

/**
 * Resolve the canonical launch tier from the environment.
 *
 * ONE canonical contract: `LAUNCH_MODE=beta|paid`. It is already the variable
 * the release check, the legal-config guard and instrumentation use; runtime
 * readiness now derives its mode from the same source so the CLI and the
 * running app can never silently disagree.
 *
 * `READINESS_MODE` is a DEPRECATED alias kept only for backwards compatibility.
 * If it is present it must AGREE with LAUNCH_MODE; a mismatch or an invalid
 * value is a misconfiguration (`ok:false`).
 *
 * A production deployment (NODE_ENV=production) with LAUNCH_MODE unset or
 * invalid is a misconfiguration — it does NOT silently fall back to beta. Local
 * development may default to beta only when NODE_ENV is not production.
 */
export function resolveLaunchMode(
  env: Record<string, string | undefined> = process.env
): LaunchModeResolution {
  const raw = env.LAUNCH_MODE;
  const legacy = env.READINESS_MODE;
  const isProd = env.NODE_ENV === "production";

  let mode: ReadinessMode;
  let ok = true;
  let problem: string | undefined;

  if (raw === "paid" || raw === "beta") {
    mode = raw;
  } else if (raw == null || raw === "") {
    if (isProd) {
      // Never silently default a production deployment to beta.
      ok = false;
      problem = "LAUNCH_MODE is not set in production";
      mode = "paid"; // strictest gating while misconfigured
    } else {
      mode = "beta"; // local/dev default only
    }
  } else {
    ok = false;
    problem = "LAUNCH_MODE has an invalid value (allowed: beta, paid)";
    mode = "paid";
  }

  if (legacy != null && legacy !== "") {
    const legacyMode: ReadinessMode | null =
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

/**
 * Resolve the readiness mode from the environment (canonical: LAUNCH_MODE).
 * Kept for callers that only need the effective tier; use resolveLaunchMode
 * when you also need to fail closed on a misconfiguration.
 */
export function readinessMode(
  env: Record<string, string | undefined> = process.env
): ReadinessMode {
  return resolveLaunchMode(env).mode;
}

/** Safe release identifier for health output (never a secret). */
export function releaseVersion(
  env: Record<string, string | undefined> = process.env
): string {
  return env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
}
