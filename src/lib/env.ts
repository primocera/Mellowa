import "server-only";

/**
 * Server-only environment access with validation.
 * Import ONLY from server code (route handlers, server components, lib/server).
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const serverEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get aiApiKey() {
    return required("AI_PROVIDER_API_KEY");
  },
  get aiModel() {
    return process.env.AI_PROVIDER_MODEL ?? "claude-haiku-4-5-20251001";
  },
  get stripeSecretKey() {
    return required("STRIPE_SECRET_KEY");
  },
  get stripeWebhookSecret() {
    return required("STRIPE_WEBHOOK_SECRET");
  },
  get stripePriceProMonthly() {
    return required("STRIPE_PRICE_PRO_MONTHLY");
  },
  get stripePriceProYearly() {
    return required("STRIPE_PRICE_PRO_YEARLY");
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  },
  // Optional — lifecycle email (Resend). Email is skipped if unset.
  get resendApiKey() {
    return process.env.RESEND_API_KEY ?? null;
  },
  get emailFrom() {
    return process.env.EMAIL_FROM ?? "Mellowa <onboarding@resend.dev>";
  },
  // Shared secret for Vercel Cron endpoints. Routes fail closed (503) when
  // unset — required in production deployments (see lib/cron-auth.ts).
  get cronSecret() {
    return process.env.CRON_SECRET ?? null;
  },
  // Shared secret for the read-only ops stats endpoint. Fail-closed like
  // cronSecret.
  get adminStatsSecret() {
    return process.env.ADMIN_STATS_SECRET ?? null;
  },
  // Supabase user ids allowed to view the admin dashboard (comma-separated).
  // Real per-user authorization for the UI — not only a shared bearer secret.
  get adminUserIds(): string[] {
    return (process.env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
};
