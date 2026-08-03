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
  // One price id per interval, each with USD + EUR amounts attached as Stripe
  // currency_options (Scalvya's model). Checkout passes the buyer's currency on
  // this same id; it does not switch ids per currency.
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
  /**
   * The sender address, normalized.
   *
   * Production had `EMAIL_FROM=<hello@mellowa.app>` — angle brackets, no
   * display name. That is not a valid address: providers accept
   * `user@domain` or `Name <user@domain>`, and a bare `<user@domain>` is
   * rejected. Resend returned 422 to **every single send**, so Mellowa had
   * never successfully delivered one email: not a welcome, not a verification,
   * not a trial-started notice, not an account-deleted confirmation. Fifteen
   * attempts, fifteen `failed_permanent`, discovered only because the owner
   * noticed he was getting mail from a different product and none from this one.
   *
   * Stripping the brackets here means a malformed value cannot silently disable
   * all email again. It is a guard, not a licence to keep the env var wrong —
   * `npm run release-check` should also be reading this.
   */
  get emailFrom() {
    const configured = process.env.EMAIL_FROM?.trim();
    if (!configured) return "Mellowa <onboarding@resend.dev>";
    // `<addr>` with no display name → `addr`. `Name <addr>` is left alone.
    const bareAngled = configured.match(/^<\s*([^<>\s]+@[^<>\s]+)\s*>$/);
    return bareAngled ? bareAngled[1] : configured;
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
