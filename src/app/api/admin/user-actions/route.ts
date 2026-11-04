import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminRoleFor } from "@/lib/admin/auth";
import { checkPermission } from "@/lib/admin/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ADMIN_ACTIONS,
  recordAdminAction,
  type AdminAction,
} from "@/lib/admin/support";

/**
 * Safe admin actions (Launch v6, Prompt 17). Authorized via the signed-in
 * admin's Supabase session + ADMIN_USER_IDS (never a guessable URL alone).
 * Every action requires a reason and is written to admin_audit_log.
 *
 * Least privilege (MW-V18-X07 matrix, lib/admin/permissions.ts): the caller's
 * role (ADMIN_ROLES, see lib/admin/auth.ts) must meet the action's minRole, and
 * destructive actions need an explicit step-up confirmation from the console
 * (`step_up_confirmed: true`). Denials are 403 and change nothing.
 */

const ActionInput = z.object({
  action: z.enum(ADMIN_ACTIONS),
  target_user_id: z.string().uuid(),
  reason: z.string().min(3).max(500),
  // Explicit second confirmation for destructive actions (the console asks the
  // operator to confirm before sending it). Absent = not confirmed.
  step_up_confirmed: z.boolean().optional(),
});

export async function POST(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = ActionInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }
  const { action, target_user_id, reason, step_up_confirmed } = parsed.data;

  // Fail closed: no resolvable role, an under-privileged role, a missing reason
  // or an unconfirmed destructive action all deny before anything is touched.
  const role = adminRoleFor(actorId);
  if (!role) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const permission = checkPermission({
    role,
    action,
    reason,
    stepUpConfirmed: step_up_confirmed === true,
  });
  if (!permission.allowed) {
    return NextResponse.json({ error: permission.error }, { status: 403 });
  }

  const admin = createAdminClient();

  let result: Record<string, unknown> = {};
  switch (action as AdminAction) {
    case "view_user":
      break; // audit-only

    case "resend_verification": {
      const { data: userData } = await admin.auth.admin.getUserById(target_user_id);
      const email = userData?.user?.email;
      if (!email) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
      if (userData.user?.email_confirmed_at) {
        return NextResponse.json({ error: "already_verified" }, { status: 400 });
      }
      const { error } = await admin.auth.resend({ type: "signup", email });
      if (error) return NextResponse.json({ error: "resend_failed" }, { status: 502 });
      result = { resent: true };
      break;
    }

    case "replay_failed_emails": {
      // Make the user's transient failures due immediately; the outbox worker
      // (or its next external ping) replays them with the stored payload.
      const { data: updated, error } = await admin
        .from("email_deliveries")
        .update({ next_attempt_at: new Date().toISOString() })
        .eq("user_id", target_user_id)
        .in("status", ["failed_transient", "not_configured", "pending"])
        .select("id");
      if (error) return NextResponse.json({ error: "replay_failed" }, { status: 502 });
      result = { requeued: updated?.length ?? 0 };
      break;
    }

    case "flag_billing_review":
    case "unflag_billing_review": {
      const { error } = await admin.from("account_flags").upsert({
        user_id: target_user_id,
        billing_review: action === "flag_billing_review",
        updated_at: new Date().toISOString(),
      });
      if (error) return NextResponse.json({ error: "flag_failed" }, { status: 502 });
      break;
    }

    case "disable_generation":
    case "enable_generation": {
      const { error } = await admin.from("account_flags").upsert({
        user_id: target_user_id,
        generation_disabled: action === "disable_generation",
        updated_at: new Date().toISOString(),
      });
      if (error) return NextResponse.json({ error: "flag_failed" }, { status: 502 });
      break;
    }
  }

  await recordAdminAction({
    actorUserId: actorId,
    action,
    targetUserId: target_user_id,
    reason,
  });

  return NextResponse.json({ ok: true, ...result });
}
