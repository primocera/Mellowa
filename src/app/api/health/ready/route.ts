import { NextResponse } from "next/server";
import { requireBearerSecret } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  releaseVersion,
  summarizeReadiness,
  type ComponentStatus,
} from "@/lib/health";

/**
 * Deep readiness check (v6 Prompt 5). Authenticated (ADMIN_STATS_SECRET):
 * verifies database reachability, expected v6 migrations and provider
 * configuration presence without leaking any detail beyond ok/fail.
 * Returns 503 when any component fails so an uptime monitor can alert.
 */
export async function GET(request: Request) {
  const unauthorized = requireBearerSecret(
    request,
    process.env.ADMIN_STATS_SECRET
  );
  if (unauthorized) return unauthorized;

  const components: Record<string, ComponentStatus> = {
    database: "fail",
    migration_020: "fail",
    migration_021: "fail",
    email_config: process.env.RESEND_API_KEY ? "ok" : "not_configured",
    stripe_config:
      process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET
        ? "ok"
        : "not_configured",
    ai_config: process.env.AI_PROVIDER_API_KEY ? "ok" : "not_configured",
    cron_config: process.env.CRON_SECRET ? "ok" : "not_configured",
  };

  try {
    const admin = createAdminClient();
    const { error: dbError } = await admin
      .from("profiles")
      .select("id", { head: true, count: "exact" })
      .limit(1);
    components.database = dbError ? "fail" : "ok";

    const { error: genError } = await admin
      .from("generation_requests")
      .select("id", { head: true, count: "exact" })
      .limit(1);
    components.migration_020 = genError ? "fail" : "ok";

    const { error: outboxError } = await admin
      .from("email_deliveries")
      .select("next_attempt_at", { head: true, count: "exact" })
      .limit(1);
    components.migration_021 = outboxError ? "fail" : "ok";
  } catch {
    // createAdminClient throws without service-role config.
    components.database = "fail";
  }

  const report = summarizeReadiness(components);
  return NextResponse.json(
    { ...report, version: releaseVersion() },
    { status: report.ok ? 200 : 503 }
  );
}
