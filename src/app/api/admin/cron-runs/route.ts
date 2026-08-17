import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { CRON_REGISTRY } from "@/lib/ops/cron-registry";

/**
 * MW-05: admin readout of the durable cron_runs ledger.
 *
 * Returns per-registered-job health (last run/success/failure + status) and a
 * bounded window of recent runs — STATUS, CATEGORIES and COUNTS only. The
 * cron_runs table has no recipient, user id, wellbeing content or raw error, so
 * none can leak here. Admin-gated (404 to non-admins, never revealing the route).
 */
export async function GET() {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = createAdminClient();
  const { data: health, error: healthErr } = await admin.rpc("cron_job_health");
  const { data: recent, error: recentErr } = await admin
    .from("cron_runs")
    .select(
      "job_id, status, started_at, completed_at, duration_ms, processed, error_category, lease_outcome, release_sha"
    )
    .order("started_at", { ascending: false })
    .limit(50);

  if (healthErr || recentErr) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  // Registered jobs that have never produced a ledger row — surfaced explicitly
  // so a scheduler that was never configured is visible, not silently absent.
  const seen = new Set(
    (Array.isArray(health) ? health : []).map((r) => (r as { job_id: string }).job_id)
  );
  const neverRun = CRON_REGISTRY.filter((j) => !seen.has(j.id)).map((j) => ({
    job_id: j.id,
    cadence: j.schedule.cadence,
    source: j.schedule.source,
  }));

  return NextResponse.json({ ok: true, health: health ?? [], recent: recent ?? [], neverRun });
}
