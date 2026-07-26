/**
 * Readiness aggregation (Launch audit v6, Prompt 5). Pure module.
 *
 * Components report ok/fail only — never connection strings, table names or
 * error details. The deep readiness route maps this to 200/503 so a free
 * uptime monitor (e.g. UptimeRobot) can alert the owner on any failure.
 */

export type ComponentStatus = "ok" | "fail" | "not_configured";

export interface ReadinessReport {
  ok: boolean;
  components: Record<string, ComponentStatus>;
}

export function summarizeReadiness(
  components: Record<string, ComponentStatus>
): ReadinessReport {
  // not_configured is visible but does not fail readiness: beta runs without
  // e.g. Stripe live keys, and the paid-launch gate lives in instrumentation.
  const ok = Object.values(components).every((s) => s !== "fail");
  return { ok, components };
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

/** Safe release identifier for health output (never a secret). */
export function releaseVersion(
  env: Record<string, string | undefined> = process.env
): string {
  return env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
}
