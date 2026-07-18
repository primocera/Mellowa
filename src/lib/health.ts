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

/** Safe release identifier for health output (never a secret). */
export function releaseVersion(
  env: Record<string, string | undefined> = process.env
): string {
  return env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
}
