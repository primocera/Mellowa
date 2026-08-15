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
    if (paid && critical.has(key) && (s === "degraded" || s === "unavailable")) {
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
 *   - PGRST202 "function not found in schema cache" → the overload the app
 *     calls does not exist on this database. The migration was not applied,
 *     or was applied with a different argument list. Fail.
 *   - anything else (typically 22P02 invalid input syntax for uuid) → the
 *     signature resolved and argument coercion ran. The overload exists.
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
  return "ok";
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

/** Resolve the readiness mode from the environment (defaults to beta). */
export function readinessMode(
  env: Record<string, string | undefined> = process.env
): ReadinessMode {
  return env.READINESS_MODE === "paid" ? "paid" : "beta";
}

/** Safe release identifier for health output (never a secret). */
export function releaseVersion(
  env: Record<string, string | undefined> = process.env
): string {
  return env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
}
