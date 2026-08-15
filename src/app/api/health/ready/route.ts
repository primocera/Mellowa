import { NextResponse } from "next/server";
import { requireBearerSecret } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  classifyRpcProbe,
  classifyWorkerFreshness,
  readinessMode,
  releaseVersion,
  summarizeReadiness,
  type ComponentStatus,
} from "@/lib/health";

/**
 * Deep operational readiness (v6 Prompt 5, extended MW-04). Authenticated
 * (ADMIN_STATS_SECRET): verifies database reachability, the required migration
 * objects the CURRENT product line depends on (not just legacy 020/021), the
 * exact RPC overloads the app calls, provider configuration presence, and the
 * freshness of the critical background workers — all with side-effect-free
 * probes that never leak an id, address, error detail or content.
 *
 * In paid mode (READINESS_MODE=paid) a missing required object (fail) or a
 * degraded/unavailable critical worker fails closed with 503. In beta mode a
 * degraded/unavailable worker is surfaced but warn-only; a missing required
 * object still fails. Kept separate from the public pricing readiness endpoint.
 */

/** Components whose degraded/unavailable state blocks PAID readiness. */
const CRITICAL = [
  "database",
  "migration_020",
  "migration_021",
  "migration_044_account_deletion",
  "migration_045_cohort_facts",
  "migration_046_onboarding_provenance",
  "migration_047_support_tickets",
  "migration_048_activation_facts",
  "migration_049_canonical_daily_plan",
  "rpc_claim_ai_generation_v035",
  "rpc_undo_plan_repair_v034",
  "rpc_account_deletion_stats_v044",
  "deletion_worker_freshness",
  "outbox_freshness",
] as const;

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
    // Current product-line migrations (MW-04). Presence/signature only.
    migration_044_account_deletion: "fail",
    migration_045_cohort_facts: "fail",
    migration_046_onboarding_provenance: "fail",
    migration_047_support_tickets: "fail",
    migration_048_activation_facts: "fail",
    migration_049_canonical_daily_plan: "fail",
    // The RPC overloads the app calls; table presence never proves the args.
    rpc_claim_ai_generation_v035: "fail",
    rpc_undo_plan_repair_v034: "fail",
    rpc_account_deletion_stats_v044: "fail",
    // Worker freshness — unavailable until observed.
    deletion_worker_freshness: "unavailable",
    outbox_freshness: "unavailable",
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
    const probeTable = async (
      table: string,
      column = "id"
    ): Promise<ComponentStatus> => {
      const { error } = await admin
        .from(table)
        .select(column, { head: true, count: "exact" })
        .limit(1);
      return error ? "fail" : "ok";
    };

    components.database = await probeTable("profiles");
    components.migration_020 = await probeTable("generation_requests");
    components.migration_021 = await probeTable("email_deliveries", "next_attempt_at");
    // 044-049: a missing object here means the current product line cannot run.
    components.migration_044_account_deletion = await probeTable("account_deletion_requests");
    components.migration_045_cohort_facts = await probeTable("analytics_excluded_users");
    // 046 added provenance columns to onboarding_completions; probe the column.
    components.migration_046_onboarding_provenance = await probeTable(
      "onboarding_completions",
      "source"
    );
    components.migration_047_support_tickets = await probeTable("support_tickets");
    // 048 (re)defines the security-invoker activation view; probe it directly.
    components.migration_048_activation_facts = await probeTable(
      "analytics_activation_facts",
      "user_id"
    );
    // 049 added the superseded_at marker + canonical unique index.
    components.migration_049_canonical_daily_plan = await probeTable(
      "daily_plans",
      "superseded_at"
    );

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

    // account_deletion_stats is read-only, so it doubles as a signature probe
    // AND the deletion-worker freshness signal (open/stuck jobs + oldest open).
    const { data: delStats, error: delError } = await admin.rpc("account_deletion_stats", {
      p_stuck_attempts: 3,
    });
    if (delError) {
      components.rpc_account_deletion_stats_v044 = classifyRpcProbe(delError);
      components.deletion_worker_freshness = "unavailable";
    } else {
      components.rpc_account_deletion_stats_v044 = "ok";
      const row = Array.isArray(delStats) ? delStats[0] : delStats;
      const stuck = Number(row?.stuck_jobs ?? 0);
      const oldestOpen = row?.oldest_open ? Date.parse(row.oldest_open as string) : null;
      components.deletion_worker_freshness = classifyWorkerFreshness({
        stuckOrDead: stuck,
        oldestDueMs: oldestOpen,
      });
    }

    // Outbox freshness from email_deliveries: dead-letter (failed_permanent) count
    // plus the oldest still-due attempt. Counts only, no addresses or content.
    const { count: deadCount, error: deadErr } = await admin
      .from("email_deliveries")
      .select("id", { head: true, count: "exact" })
      .eq("status", "failed_permanent");
    const { data: dueRows, error: dueErr } = await admin
      .from("email_deliveries")
      .select("next_attempt_at")
      .in("status", ["pending", "failed_transient"])
      .order("next_attempt_at", { ascending: true })
      .limit(1);
    if (deadErr || dueErr) {
      components.outbox_freshness = "unavailable";
    } else {
      const oldestDue = dueRows?.[0]?.next_attempt_at
        ? Date.parse(dueRows[0].next_attempt_at as string)
        : null;
      components.outbox_freshness = classifyWorkerFreshness({
        stuckOrDead: deadCount ?? 0,
        oldestDueMs: oldestDue,
      });
    }
  } catch {
    // createAdminClient throws without service-role config.
    components.database = "fail";
  }

  const mode = readinessMode();
  const report = summarizeReadiness(components, { mode, critical: CRITICAL });
  return NextResponse.json(
    { ...report, version: releaseVersion() },
    { status: report.ok ? 200 : 503 }
  );
}
