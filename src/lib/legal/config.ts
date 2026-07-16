/**
 * Legal / production configuration (Prompt 17, audit v5). Pure module.
 *
 * All values come from the environment so no placeholder identity is baked
 * into code. `validateLegalConfig` lists everything that blocks a PAID
 * launch; enforcement happens at server startup when LAUNCH_MODE=paid
 * (see src/instrumentation.ts) so the free/beta deployment keeps working
 * while a paid launch with placeholders is impossible.
 */

export interface LegalConfig {
  entityName: string | null;
  registeredAddress: string | null;
  supportEmail: string;
  privacyEmail: string;
  governingLaw: string | null;
  appUrl: string;
}

export function readLegalConfig(
  env: Record<string, string | undefined> = process.env
): LegalConfig {
  return {
    entityName: env.LEGAL_ENTITY_NAME ?? null,
    registeredAddress: env.LEGAL_REGISTERED_ADDRESS ?? null,
    supportEmail: env.SUPPORT_EMAIL ?? "support@mellowa.app",
    privacyEmail: env.PRIVACY_EMAIL ?? env.SUPPORT_EMAIL ?? "support@mellowa.app",
    governingLaw: env.LEGAL_GOVERNING_LAW ?? null,
    appUrl: env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };
}

/** Problems that must be fixed before charging the public. */
export function validateLegalConfig(
  env: Record<string, string | undefined> = process.env
): string[] {
  const cfg = readLegalConfig(env);
  const problems: string[] = [];
  if (!cfg.entityName) problems.push("LEGAL_ENTITY_NAME is not set");
  if (!cfg.registeredAddress) problems.push("LEGAL_REGISTERED_ADDRESS is not set");
  if (!cfg.governingLaw) problems.push("LEGAL_GOVERNING_LAW is not set");
  if (!env.SUPPORT_EMAIL) {
    problems.push("SUPPORT_EMAIL is not set (hardcoded fallback in use)");
  }
  if (/\.vercel\.app/i.test(cfg.appUrl) || /localhost/i.test(cfg.appUrl)) {
    problems.push(`NEXT_PUBLIC_APP_URL is a temporary domain: ${cfg.appUrl}`);
  }
  if (/resend\.dev/i.test(env.EMAIL_FROM ?? "")) {
    problems.push("EMAIL_FROM uses the resend.dev placeholder domain");
  }
  return problems;
}

/** True when this deployment is meant to charge the public. */
export function isPaidLaunch(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.LAUNCH_MODE === "paid";
}
