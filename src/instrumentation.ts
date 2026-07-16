/**
 * Server startup validation (Prompt 1, audit v5). Runs once when the Next.js
 * server boots. A production deployment missing operational secrets refuses
 * to start rather than exposing unauthenticated cron/admin endpoints.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { missingOperationalSecrets } = await import("./lib/cron-auth");
  const missing = missingOperationalSecrets();
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start in production: missing operational secrets ${missing.join(
        ", "
      )}. Set them in the deployment environment.`
    );
  }

  // Legal/production config (Prompt 17): a PAID launch (LAUNCH_MODE=paid)
  // refuses to start with placeholder identity, domain or email config.
  // Free/beta deployments log the outstanding items instead.
  const { validateLegalConfig, isPaidLaunch } = await import("./lib/legal/config");
  const problems = validateLegalConfig();
  if (problems.length > 0) {
    if (isPaidLaunch()) {
      throw new Error(
        `Refusing paid launch with placeholder legal configuration: ${problems.join("; ")}`
      );
    }
    if (process.env.NODE_ENV === "production") {
      console.warn("[legal] outstanding before paid launch:", problems);
    }
  }
}
