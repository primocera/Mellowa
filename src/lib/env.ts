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
  // Optional — shared secret for Vercel Cron endpoints.
  get cronSecret() {
    return process.env.CRON_SECRET ?? null;
  },
};
