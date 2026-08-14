import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { recordAdminAction } from "@/lib/admin/support";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  runOnboardingBackfill,
  type BackfillDeps,
  type ProfileRow,
  type CompletionInsert,
} from "@/lib/onboarding/backfill";

/**
 * MW-V18-06: admin-only onboarding-completion backfill.
 *
 * GET  (?dryRun=1, default) — report the eligible / backfilled(-would) /
 *      skipped-partial / already-present counts WITHOUT writing anything.
 * POST (dryRun:false) — actually insert the inferred completions, idempotently.
 *
 * Authorized by the signed-in admin's session + ADMIN_USER_IDS (never a
 * guessable URL). Every real run is written to admin_audit_log. No PII in the
 * response — counts only. No analytics events or emails are emitted.
 */

function makeDeps(): BackfillDeps {
  const admin = createAdminClient();
  return {
    async fetchProfilesPage(cursor, limit) {
      let q = admin
        .from("wellbeing_profiles")
        .select("user_id, safety_acknowledged, primary_goal, updated_at, created_at")
        .order("user_id", { ascending: true })
        .limit(limit);
      if (cursor) q = q.gt("user_id", cursor);
      const { data, error } = await q;
      if (error) throw Object.assign(new Error("fetch_profiles_failed"), { code: error.code ?? "fetch_failed" });
      return (data ?? []) as ProfileRow[];
    },
    async fetchExistingCompletionIds(userIds) {
      if (userIds.length === 0) return new Set();
      const { data, error } = await admin
        .from("onboarding_completions")
        .select("user_id")
        .in("user_id", userIds);
      if (error) throw Object.assign(new Error("fetch_existing_failed"), { code: error.code ?? "fetch_failed" });
      return new Set((data ?? []).map((r) => (r as { user_id: string }).user_id));
    },
    async insertCompletions(rows: CompletionInsert[]) {
      // ON CONFLICT DO NOTHING: the primary key is the exactly-once authority, so
      // a concurrent runtime completion is absorbed rather than duplicated.
      const { data, error } = await admin
        .from("onboarding_completions")
        .upsert(rows, { onConflict: "user_id", ignoreDuplicates: true })
        .select("user_id");
      if (error) throw Object.assign(new Error("insert_failed"), { code: error.code ?? "insert_failed" });
      return (data ?? []).length;
    },
  };
}

async function handle(dryRun: boolean, actorId: string) {
  const report = await runOnboardingBackfill(makeDeps(), { dryRun });
  if (!dryRun) {
    await recordAdminAction({
      actorUserId: actorId,
      action: "onboarding_backfill",
      reason: `legacy onboarding backfill (${report.definitionVersion}): backfilled ${report.backfilled}, skipped ${report.skippedPartial} partial, ${report.failed} failed`,
    });
  }
  return NextResponse.json(report);
}

export async function GET(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const dryRun = new URL(request.url).searchParams.get("dryRun") !== "0";
  return handle(dryRun, actorId);
}

export async function POST(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  let body: { dryRun?: boolean } = {};
  try {
    body = (await request.json()) as { dryRun?: boolean };
  } catch {
    // empty body → treat as a real run
  }
  return handle(body.dryRun === true, actorId);
}
