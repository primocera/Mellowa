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
}
