import { NextResponse } from "next/server";
import { requireBearerSecret } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  classifyRpcProbe,
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
    // The two v9 RPC overloads the app calls on every generation and every
    // repair Undo. Table presence does not imply the right argument list.
    rpc_claim_ai_generation_v035: "fail",
    rpc_undo_plan_repair_v034: "fail",
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

    // Probe the exact overloads with a malformed uuid: argument coercion fails
    // before the body runs, so this proves the signature without side effects.
    const BAD_UUID = "not-a-uuid";
    const { error: claimError } = await admin.rpc("claim_ai_generation", {
      p_user_id: BAD_UUID,
      p_route: "readiness_probe",
      p_per_hour: 0,
      p_per_day: 0,
      p_per_month: 0,
      p_est_cost: 0,
      p_global_daily_ceiling: 0,
    });
    components.rpc_claim_ai_generation_v035 = classifyRpcProbe(claimError);

    const { error: undoError } = await admin.rpc("undo_plan_repair", {
      p_user_id: BAD_UUID,
      p_plan_id: BAD_UUID,
      p_expected_version: -1,
    });
    components.rpc_undo_plan_repair_v034 = classifyRpcProbe(undoError);
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
