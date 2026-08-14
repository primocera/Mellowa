import { ADMIN_ACTIONS, type AdminAction } from "@/lib/admin/support";

/**
 * MW-V18-X07: least-privilege permission matrix for the admin/support console.
 *
 * Default is READ-ONLY. Any action that touches billing, deletion, entitlement
 * or generation is destructive: it requires an elevated role, an explicit reason
 * and a step-up confirmation, and is written to the immutable audit log
 * (recordAdminAction). Lookups minimise email and never expose raw wellbeing
 * content, secrets or model prompts.
 *
 * Pure module — the matrix and checks are fully testable.
 */

export type AdminRole = "viewer" | "operator" | "owner";
const ROLE_RANK: Record<AdminRole, number> = { viewer: 0, operator: 1, owner: 2 };

/** Every admin action, including the V18 additions, with its policy. */
export type AdminActionName = AdminAction | "onboarding_backfill" | "support_ticket_import";

export interface ActionPolicy {
  category: "read" | "support" | "billing" | "deletion" | "generation" | "data_job";
  destructive: boolean;
  requiresStepUp: boolean;
  requiresReason: boolean;
  minRole: AdminRole;
}

export const ADMIN_ACTION_POLICY: Record<AdminActionName, ActionPolicy> = {
  view_user: { category: "read", destructive: false, requiresStepUp: false, requiresReason: false, minRole: "viewer" },
  resend_verification: { category: "support", destructive: false, requiresStepUp: false, requiresReason: true, minRole: "operator" },
  support_ticket_import: { category: "support", destructive: false, requiresStepUp: false, requiresReason: true, minRole: "operator" },
  replay_failed_emails: { category: "support", destructive: true, requiresStepUp: true, requiresReason: true, minRole: "operator" },
  flag_billing_review: { category: "billing", destructive: true, requiresStepUp: true, requiresReason: true, minRole: "operator" },
  unflag_billing_review: { category: "billing", destructive: true, requiresStepUp: true, requiresReason: true, minRole: "operator" },
  disable_generation: { category: "generation", destructive: true, requiresStepUp: true, requiresReason: true, minRole: "operator" },
  enable_generation: { category: "generation", destructive: true, requiresStepUp: true, requiresReason: true, minRole: "operator" },
  onboarding_backfill: { category: "data_job", destructive: true, requiresStepUp: true, requiresReason: true, minRole: "owner" },
};

export function policyFor(action: AdminActionName): ActionPolicy | undefined {
  return ADMIN_ACTION_POLICY[action];
}

export interface PermissionRequest {
  role: AdminRole;
  action: AdminActionName;
  reason?: string;
  stepUpConfirmed?: boolean;
}

export type PermissionResult =
  | { allowed: true }
  | { allowed: false; error: "unknown_action" | "insufficient_role" | "reason_required" | "step_up_required" };

/**
 * Decide whether an admin request is permitted. Fails closed on every missing
 * requirement — an unknown action, an under-privileged role, a missing reason or
 * an unconfirmed step-up all deny.
 */
export function checkPermission(req: PermissionRequest): PermissionResult {
  const policy = ADMIN_ACTION_POLICY[req.action];
  if (!policy) return { allowed: false, error: "unknown_action" };
  if (ROLE_RANK[req.role] < ROLE_RANK[policy.minRole]) {
    return { allowed: false, error: "insufficient_role" };
  }
  if (policy.requiresReason && !(req.reason && req.reason.trim().length >= 3)) {
    return { allowed: false, error: "reason_required" };
  }
  if (policy.requiresStepUp && req.stepUpConfirmed !== true) {
    return { allowed: false, error: "step_up_required" };
  }
  return { allowed: true };
}

/** The base admin action set (from admin/support) that must all have a policy. */
export const BASE_ADMIN_ACTIONS = ADMIN_ACTIONS;
